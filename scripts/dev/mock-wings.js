// A tiny stand-in for Wings so the Panel's file manager, editor and dashboard can be developed and tested without a
// game host. It serves a real folder per server and implements only the endpoints the Panel calls.
//
//   node scripts/dev/mock-wings.js [port] [dataDir]
//
// Never use it outside development: it performs no authentication.
//
// To exercise the server provisioning pipeline end to end it also accepts server creation, power and deletion
// requests. When MOCK_PANEL_URL, MOCK_NODE_TOKEN_ID and MOCK_NODE_TOKEN are set, a created server "finishes installing"
// two seconds later by calling the Panel's install callback, exactly like a real Wings would.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const port = Number(process.argv[2] || 8080);
const dataDir = path.resolve(process.argv[3] || path.join(__dirname, '../../storage/mock-wings'));

const panelUrl = process.env.MOCK_PANEL_URL;
const nodeAuth = process.env.MOCK_NODE_TOKEN_ID ? `Bearer ${process.env.MOCK_NODE_TOKEN_ID}.${process.env.MOCK_NODE_TOKEN}` : null;
const installed = new Set();

const reportInstall = (uuid) => {
    if (!panelUrl || !nodeAuth) return;
    setTimeout(() => {
        fetch(`${panelUrl}/api/remote/servers/${uuid}/install`, {
            method: 'POST',
            headers: { Authorization: nodeAuth, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ successful: true, reinstall: false }),
        })
            .then((r) => console.log(`install callback for ${uuid}: ${r.status}`))
            .catch((e) => console.log(`install callback failed: ${e.message}`));
    }, 2000);
};

const mime = (name) => {
    const ext = path.extname(name).toLowerCase();
    if (['.png', '.jpg', '.gif'].includes(ext)) return 'image/' + ext.slice(1);
    if (ext === '.jar') return 'application/jar';

    return 'text/plain; charset=utf-8';
};

const resolveInside = (uuid, relative) => {
    const root = path.join(dataDir, uuid);
    fs.mkdirSync(root, { recursive: true });
    const target = path.resolve(root, '.' + path.posix.normalize('/' + (relative || '/')));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('path escapes the server root');

    return target;
};

const body = (req) =>
    new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });

const json = (res, data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams;
    const parts = url.pathname.split('/').filter(Boolean); // api, servers, <uuid>, files, <op>

    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    try {
        if (url.pathname === '/api/system') return json(res, { version: '1.11.0-mock', architecture: 'amd64', cpu_count: 4, kernel_version: 'mock', os: 'linux' });

        const usage = (uuid) => ({
            state: 'running',
            utilization: { state: 'running', memory_bytes: 512 * 1048576, memory_limit_bytes: 1024 * 1048576, cpu_absolute: 35.5, disk_bytes: 2048 * 1048576, network: { rx_bytes: 0, tx_bytes: 0 }, uptime: 1000 },
            is_suspended: false,
            configuration: { uuid },
        });

        if (url.pathname === '/api/servers' && req.method === 'GET') {
            const known = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

            return json(res, known.map(usage));
        }

        if (url.pathname === '/api/servers' && req.method === 'POST') {
            const data = JSON.parse((await body(req)).toString() || '{}');
            if (!/^[0-9a-f-]{36}$/.test(data.uuid || '')) return json(res, { error: 'invalid uuid' }, 422);
            fs.mkdirSync(path.join(dataDir, data.uuid), { recursive: true });
            installed.add(data.uuid);
            reportInstall(data.uuid);

            return res.writeHead(202).end();
        }

        if (url.pathname === '/upload/file' && req.method === 'POST') {
            const raw = await body(req);
            const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] || '')[1];
            const part = raw.toString('latin1').split('--' + boundary).find((p) => /filename="/.test(p));
            const name = /filename="([^"]+)"/.exec(part)[1];
            const start = part.indexOf('\r\n\r\n') + 4;
            const content = Buffer.from(part.slice(start, part.lastIndexOf('\r\n')), 'latin1');
            const uuid = fs.readdirSync(dataDir)[0];
            fs.writeFileSync(path.join(resolveInside(uuid, q.get('directory') || '/'), path.basename(name)), content);

            return res.writeHead(200).end();
        }

        if (parts[0] !== 'api' || parts[1] !== 'servers' || !parts[2]) return json(res, { error: 'not found' }, 404);
        const uuid = parts[2];
        if (!/^[0-9a-f-]{36}$/.test(uuid)) return json(res, { error: 'invalid uuid' }, 422);
        if (parts.length === 3 && req.method === 'DELETE') {
            fs.rmSync(path.join(dataDir, uuid), { recursive: true, force: true });

            return res.writeHead(204).end();
        }
        if (parts.length === 3) return json(res, usage(uuid));
        if (parts[3] === 'power' && req.method === 'POST') {
            console.log(`power ${(JSON.parse((await body(req)).toString() || '{}')).action} -> ${uuid}`);

            return res.writeHead(202).end();
        }
        if (parts[3] !== 'files') return json(res, { error: 'not found' }, 404);

        switch (parts[4]) {
            case 'list-directory': {
                const dir = resolveInside(uuid, q.get('directory'));
                const entries = fs.readdirSync(dir).map((name) => {
                    const stat = fs.statSync(path.join(dir, name));

                    return {
                        name,
                        created: stat.birthtime.toISOString(),
                        modified: stat.mtime.toISOString(),
                        mode: stat.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--',
                        mode_bits: stat.isDirectory() ? '755' : '644',
                        size: stat.size,
                        directory: stat.isDirectory(),
                        file: stat.isFile(),
                        symlink: false,
                        mime: stat.isDirectory() ? 'inode/directory' : mime(name),
                    };
                });

                return json(res, entries);
            }
            case 'contents': {
                const content = fs.readFileSync(resolveInside(uuid, q.get('file')));
                res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': content.length });

                return res.end(content);
            }
            case 'write': {
                const target = resolveInside(uuid, q.get('file'));
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, await body(req));

                return res.writeHead(204).end();
            }
            case 'create-directory': {
                const data = JSON.parse((await body(req)).toString());
                fs.mkdirSync(path.join(resolveInside(uuid, data.path), path.basename(data.name)), { recursive: true });

                return res.writeHead(204).end();
            }
            case 'rename': {
                const data = JSON.parse((await body(req)).toString());
                data.files.forEach((f) => fs.renameSync(path.join(resolveInside(uuid, data.root), path.basename(f.from)), path.join(resolveInside(uuid, data.root), path.basename(f.to))));

                return res.writeHead(204).end();
            }
            case 'delete': {
                const data = JSON.parse((await body(req)).toString());
                data.files.forEach((f) => fs.rmSync(path.join(resolveInside(uuid, data.root), path.basename(f)), { recursive: true, force: true }));

                return res.writeHead(204).end();
            }
            default:
                return json(res, { error: 'not implemented' }, 404);
        }
    } catch (error) {
        return json(res, { error: String(error.message) }, 500);
    }
}).listen(port, '127.0.0.1', () => console.log(`mock wings on http://127.0.0.1:${port}, data in ${dataDir}`));
