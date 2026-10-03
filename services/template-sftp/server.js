'use strict';
// SFTP access to the working files of one Gobia Panel server template.
//
// A login is checked by the Panel (POST /api/internal/template-sftp/authenticate). A successful login is jailed to
// <TEMPLATE_STORAGE>/<template uuid>/work and cannot see anything else: not other templates, not the Panel. Symlinks
// are never followed or created. See lib/jail.js for the path rules.
//
//   PANEL_URL              base URL of the Panel (default http://127.0.0.1:8000)
//   SFTP_SERVICE_TOKEN     shared secret, must match GOBIA_SFTP_SERVICE_TOKEN of the Panel (32+ characters)
//   TEMPLATE_STORAGE       absolute path of the Panel's template storage (storage/app/private/templates)
//   SFTP_PORT / SFTP_BIND  listen port (2223) and address (0.0.0.0)
//   SFTP_HOST_KEY          path of the SSH host key; an ed25519 key is generated there on first start
const fs = require('node:fs');
const path = require('node:path');
const { Server, utils } = require('ssh2');
const { Jail, JailError, assertValidName, virtual } = require('./lib/jail');

const { OPEN_MODE, STATUS_CODE } = utils.sftp;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDLE_MS = 15 * 60 * 1000;
const MAX_CONNECTIONS = 100;
const MAX_PER_IP = 10;
const MAX_AUTH_ATTEMPTS = 3;

const defaults = () => ({
    panelUrl: (process.env.PANEL_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
    token: process.env.SFTP_SERVICE_TOKEN || '',
    storage: process.env.TEMPLATE_STORAGE || '',
    port: Number(process.env.SFTP_PORT || 2223),
    bind: process.env.SFTP_BIND || '0.0.0.0',
    hostKey: process.env.SFTP_HOST_KEY || path.join(process.cwd(), 'host_ed25519'),
});

const loadHostKey = (file) => {
    if (!fs.existsSync(file)) {
        const pair = utils.generateKeyPairSync('ed25519');
        fs.writeFileSync(file, pair.private, { mode: 0o600 });
    }

    return fs.readFileSync(file);
};

const status = (e) => (e && e.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : e instanceof JailError || (e && (e.code === 'EACCES' || e.code === 'EPERM')) ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE);

function createService(options = {}) {
    const config = { ...defaults(), ...options };
    const failures = new Map(); // ip -> [timestamps]
    const perIp = new Map();
    let connections = 0;

    const panel = async (endpoint, body) => {
        const response = await fetch(config.panelUrl + '/api/internal/template-sftp/' + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + config.token },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });

        return response.ok ? (response.status === 204 ? {} : response.json()) : null;
    };

    const blocked = (ip) => {
        const recent = (failures.get(ip) || []).filter((t) => Date.now() - t < 10 * 60 * 1000);
        failures.set(ip, recent);

        return recent.length >= 10;
    };

    const server = new Server({ hostKeys: [loadHostKey(config.hostKey)], banner: '', ident: 'Gobia-Template-SFTP' }, (client, info) => {
        const ip = String(info.ip || '').replace('::ffff:', '');
        if (connections >= MAX_CONNECTIONS || (perIp.get(ip) || 0) >= MAX_PER_IP || blocked(ip)) {
            client.end();

            return;
        }
        connections++;
        perIp.set(ip, (perIp.get(ip) || 0) + 1);

        let attempts = 0;
        let grant = null;
        let jail = null;
        let usage = { bytes: 0, files: 0 };
        const stats = { changed: new Set(), bytes: 0 };
        let idle = setTimeout(() => client.end(), IDLE_MS);
        idle.unref();
        const touch = () => {
            clearTimeout(idle);
            idle = setTimeout(() => client.end(), IDLE_MS);
            idle.unref();
        };

        client.on('error', () => {});
        client.on('authentication', async (ctx) => {
            if (ctx.method !== 'password') return ctx.reject(['password']);
            if (++attempts > MAX_AUTH_ATTEMPTS) return client.end();
            try {
                const result = await panel('authenticate', { username: ctx.username, password: ctx.password, ip });
                if (!result || !UUID.test(result.template || '')) throw new Error('rejected');
                const root = path.join(config.storage, result.template, 'work');
                if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true, mode: 0o750 });
                jail = new Jail(root);
                grant = result;
                usage = jail.usage();
                ctx.accept();
            } catch (e) {
                const list = failures.get(ip) || [];
                list.push(Date.now());
                failures.set(ip, list);
                // A small delay makes password guessing slow without holding resources.
                setTimeout(() => ctx.reject(['password']), 400);
            }
        });

        client.on('ready', () => {
            client.on('session', (accept) => {
                const session = accept();
                // Only SFTP: no shell, no exec, no port forwarding.
                session.on('sftp', (acceptSftp) => serve(acceptSftp(), { grant, jail, usage: () => usage, stats, touch }));
                session.on('shell', (a, reject) => reject());
                session.on('exec', (a, reject) => reject());
                session.on('pty', (a, reject) => reject());
            });
        });
        client.on('request', (accept, reject) => reject());

        client.on('close', () => {
            clearTimeout(idle);
            connections--;
            perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1));
            if (grant) {
                panel('session', { credential: grant.credential, files_changed: stats.changed.size, bytes_written: stats.bytes, ip }).catch(() => {});
            }
        });
    });

    return {
        server,
        listen: () => new Promise((resolve) => server.listen(config.port, config.bind, () => resolve(server.address()))),
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

function serve(sftp, ctx) {
    const { grant, jail, stats, touch } = ctx;
    const writable = grant.permission === 'rw';
    const limits = grant.limits;
    const handles = new Map();
    let counter = 0;

    const newHandle = (entry) => {
        const id = Buffer.alloc(4);
        id.writeUInt32BE(++counter);
        handles.set(id.toString('hex'), entry);

        return id;
    };
    const find = (handle) => handles.get(Buffer.from(handle).toString('hex'));
    const drop = (handle) => handles.delete(Buffer.from(handle).toString('hex'));
    const attrsOf = (st) => ({ mode: st.mode, uid: 0, gid: 0, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
    const fail = (reqid, e) => { if (process.env.SFTP_DEBUG) console.error('sftp error', e && e.message); sftp.status(reqid, status(e)); };
    const deny = (reqid) => {
        if (process.env.SFTP_DEBUG) console.error('deny at', (new Error().stack.split('\n')[2] || '').trim());
        sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    };
    const wrap = (name, handler) =>
        sftp.on(name, (...args) => {
            touch();
            try {
                handler(...args);
            } catch (e) {
                fail(args[0], e);
            }
        });

    wrap('REALPATH', (reqid, p) => {
        const v = virtual(p);
        sftp.name(reqid, [{ filename: v, longname: v, attrs: {} }]);
    });

    const stat = (reqid, p, follow) => {
        const st = fs.lstatSync(jail.resolve(p));
        sftp.attrs(reqid, attrsOf(st));
    };
    wrap('STAT', (reqid, p) => stat(reqid, p));
    wrap('LSTAT', (reqid, p) => stat(reqid, p));
    wrap('FSTAT', (reqid, handle) => {
        const h = find(handle);
        if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
        sftp.attrs(reqid, attrsOf(h.fd !== undefined ? fs.fstatSync(h.fd) : fs.lstatSync(h.path)));
    });

    wrap('OPENDIR', (reqid, p) => {
        const dir = jail.resolve(p);
        if (!fs.statSync(dir).isDirectory()) return sftp.status(reqid, STATUS_CODE.FAILURE);
        const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.isSymbolicLink());
        sftp.handle(reqid, newHandle({ dir: true, path: dir, entries, sent: false }));
    });
    wrap('READDIR', (reqid, handle) => {
        const h = find(handle);
        if (!h || !h.dir || h.sent) return sftp.status(reqid, STATUS_CODE.EOF);
        h.sent = true;
        const list = h.entries.map((e) => {
            const st = fs.lstatSync(path.join(h.path, e.name));

            return { filename: e.name, longname: `${e.isDirectory() ? 'd' : '-'}rw-r--r-- 1 template template ${st.size} Jan  1 00:00 ${e.name}`, attrs: attrsOf(st) };
        });
        if (!list.length) return sftp.status(reqid, STATUS_CODE.EOF);
        sftp.name(reqid, list);
    });

    wrap('OPEN', (reqid, filename, flags) => {
        const target = jail.resolve(filename);
        const wants = flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND | OPEN_MODE.CREAT | OPEN_MODE.TRUNC);
        if (wants && !writable) return deny(reqid);
        const exists = fs.existsSync(target);
        if (exists && !fs.lstatSync(target).isFile()) return sftp.status(reqid, STATUS_CODE.FAILURE);
        if (wants && !exists) {
            assertValidName(path.basename(target));
            if (ctx.usage().files + 1 > limits.max_files) return deny(reqid);
        }
        const mode = utils.sftp.flagsToString(flags);
        if (!mode) return sftp.status(reqid, STATUS_CODE.FAILURE);
        const fd = fs.openSync(target, mode, 0o640);
        if (wants && !exists) ctx.usage().files++;
        if (flags & OPEN_MODE.TRUNC) ctx.usage().bytes -= exists ? fs.fstatSync(fd).size : 0;
        sftp.handle(reqid, newHandle({ fd, path: target, size: fs.fstatSync(fd).size, write: !!wants }));
    });

    wrap('READ', (reqid, handle, offset, length) => {
        const h = find(handle);
        if (!h || h.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
        const buffer = Buffer.alloc(Math.min(length, 262144));
        const read = fs.readSync(h.fd, buffer, 0, buffer.length, offset);
        if (read === 0) return sftp.status(reqid, STATUS_CODE.EOF);
        sftp.data(reqid, buffer.subarray(0, read));
    });

    wrap('WRITE', (reqid, handle, offset, data) => {
        const h = find(handle);
        if (!h || h.fd === undefined || !h.write || !writable) return deny(reqid);
        const end = offset + data.length;
        const growth = Math.max(0, end - h.size);
        if (end > limits.max_file_bytes || ctx.usage().bytes + growth > limits.max_total_bytes) return sftp.status(reqid, STATUS_CODE.FAILURE);
        fs.writeSync(h.fd, data, 0, data.length, offset);
        h.size = Math.max(h.size, end);
        ctx.usage().bytes += growth;
        stats.bytes += data.length;
        stats.changed.add(h.path);
        sftp.status(reqid, STATUS_CODE.OK);
    });

    wrap('CLOSE', (reqid, handle) => {
        const h = find(handle);
        if (h && h.fd !== undefined) fs.closeSync(h.fd);
        drop(handle);
        sftp.status(reqid, STATUS_CODE.OK);
    });

    wrap('MKDIR', (reqid, p) => {
        if (!writable) return deny(reqid);
        const target = jail.resolve(p);
        assertValidName(path.basename(target));
        fs.mkdirSync(target, { mode: 0o750 });
        stats.changed.add(target);
        sftp.status(reqid, STATUS_CODE.OK);
    });
    wrap('REMOVE', (reqid, p) => {
        if (!writable) return deny(reqid);
        const target = jail.resolve(p);
        const st = fs.lstatSync(target);
        if (!st.isFile()) return sftp.status(reqid, STATUS_CODE.FAILURE);
        fs.unlinkSync(target);
        ctx.usage().bytes -= st.size;
        ctx.usage().files--;
        stats.changed.add(target);
        sftp.status(reqid, STATUS_CODE.OK);
    });
    wrap('RMDIR', (reqid, p) => {
        if (!writable) return deny(reqid);
        const target = jail.resolve(p);
        if (target === jail.root) return deny(reqid);
        fs.rmdirSync(target);
        stats.changed.add(target);
        sftp.status(reqid, STATUS_CODE.OK);
    });
    wrap('RENAME', (reqid, from, to) => {
        if (!writable) return deny(reqid);
        const source = jail.resolve(from);
        const destination = jail.resolve(to);
        if (source === jail.root || destination === jail.root) return deny(reqid);
        assertValidName(path.basename(destination));
        if (destination === source || (destination + path.sep).startsWith(source + path.sep)) return sftp.status(reqid, STATUS_CODE.FAILURE);
        if (fs.existsSync(destination)) return sftp.status(reqid, STATUS_CODE.FAILURE);
        fs.renameSync(source, destination);
        stats.changed.add(destination);
        sftp.status(reqid, STATUS_CODE.OK);
    });

    // Permissions and times are managed by the Panel; accept and ignore so clients that always send them still work.
    wrap('SETSTAT', (reqid, p) => {
        jail.resolve(p);
        sftp.status(reqid, writable ? STATUS_CODE.OK : STATUS_CODE.PERMISSION_DENIED);
    });
    wrap('FSETSTAT', (reqid) => sftp.status(reqid, writable ? STATUS_CODE.OK : STATUS_CODE.PERMISSION_DENIED));
    wrap('SYMLINK', (reqid) => deny(reqid));
    wrap('READLINK', (reqid) => deny(reqid));
    sftp.on('error', () => {});
}

module.exports = { createService };

if (require.main === module) {
    const config = defaults();
    if (config.token.length < 32 || !path.isAbsolute(config.storage)) {
        console.error('SFTP_SERVICE_TOKEN (32+ characters) and an absolute TEMPLATE_STORAGE are required.');
        process.exit(1);
    }
    createService()
        .listen()
        .then((address) => console.log(`Template SFTP listening on ${address.address}:${address.port}`));
}
