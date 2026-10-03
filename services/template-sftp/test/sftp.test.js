'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Client } = require('ssh2');
const { createService } = require('../server');
const { Jail, assertValidName, virtual } = require('../lib/jail');

const TOKEN = 'x'.repeat(40);
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gobia-sftp-'));
const storage = path.join(tmp, 'templates');
for (const uuid of [UUID_A, UUID_B]) fs.mkdirSync(path.join(storage, uuid, 'work'), { recursive: true });
fs.writeFileSync(path.join(storage, UUID_B, 'work', 'secret.txt'), 'other template');
fs.writeFileSync(path.join(tmp, 'outside.txt'), 'outside');

const limits = { max_file_bytes: 1000, max_total_bytes: 3000, max_files: 5 };
const accounts = {
    rw: { password: 'rw-pass', body: { credential: 1, template: UUID_A, permission: 'rw', limits } },
    ro: { password: 'ro-pass', body: { credential: 2, template: UUID_A, permission: 'ro', limits } },
};
const sessions = [];
let panelServer;
let service;
let port;

test.before(async () => {
    panelServer = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            const body = JSON.parse(raw || '{}');
            if (req.headers.authorization !== 'Bearer ' + TOKEN) {
                res.writeHead(403).end();

                return;
            }
            if (req.url.endsWith('/authenticate')) {
                const account = accounts[body.username];
                if (account && account.password === body.password) {
                    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(account.body));
                } else {
                    res.writeHead(401).end('{}');
                }
            } else {
                sessions.push(body);
                res.writeHead(204).end();
            }
        });
    });
    await new Promise((r) => panelServer.listen(0, '127.0.0.1', r));
    service = createService({
        panelUrl: 'http://127.0.0.1:' + panelServer.address().port,
        token: TOKEN,
        storage,
        port: 0,
        bind: '127.0.0.1',
        hostKey: path.join(tmp, 'host_key'),
    });
    port = (await service.listen()).port;
});

test.after(async () => {
    await service.close();
    panelServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

const connect = (username, password) =>
    new Promise((resolve, reject) => {
        const client = new Client();
        client.on('ready', () => client.sftp((err, sftp) => (err ? reject(err) : resolve({ client, sftp }))));
        client.on('error', reject);
        client.connect({ host: '127.0.0.1', port, username, password, readyTimeout: 5000 });
    });
const call = (fn) => new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));

test('jail normalises paths and rejects bad names', () => {
    assert.strictEqual(virtual('/../../etc/passwd'), '/etc/passwd');
    assert.strictEqual(virtual('a/../../b'), '/b');
    const jail = new Jail(path.join(storage, UUID_A, 'work'));
    assert.ok(jail.resolve('/../../outside.txt').startsWith(jail.root));
    for (const bad of ['', '..', '.env', '.PTERODACTYL', 'a%2fb', 'a\\b', 'a:b', '...', 'x'.repeat(256)]) {
        assert.throws(() => assertValidName(bad), undefined, bad);
    }
    assert.doesNotThrow(() => assertValidName('server.properties'));
});

test('wrong passwords and unknown users are refused', async () => {
    await assert.rejects(connect('rw', 'nope'));
    await assert.rejects(connect('ghost', 'x'));
});

test('read write login can upload, list, rename and delete inside its template', async () => {
    const { client, sftp } = await connect('rw', 'rw-pass');
    await call((cb) => sftp.mkdir('plugins', cb));
    await call((cb) => sftp.writeFile('plugins/config.yml', 'a: 1\n', cb));
    const names = (await call((cb) => sftp.readdir('/', cb))).map((e) => e.filename);
    assert.deepStrictEqual(names, ['plugins']);
    await call((cb) => sftp.rename('plugins/config.yml', 'plugins/moved.yml', cb));
    assert.strictEqual(fs.readFileSync(path.join(storage, UUID_A, 'work', 'plugins', 'moved.yml'), 'utf8'), 'a: 1\n');
    const content = await call((cb) => sftp.readFile('plugins/moved.yml', cb));
    assert.strictEqual(content.toString(), 'a: 1\n');
    await call((cb) => sftp.unlink('plugins/moved.yml', cb));
    await call((cb) => sftp.rmdir('plugins', cb));
    client.end();
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(sessions.some((s) => s.credential === 1 && s.files_changed > 0), 'the Panel is told the working tree changed');
});

test('parent traversal stays inside the template and never reaches other templates or the host', async () => {
    const { client, sftp } = await connect('rw', 'rw-pass');
    await call((cb) => sftp.writeFile('../../outside-write.txt', 'x', cb));
    assert.ok(fs.existsSync(path.join(storage, UUID_A, 'work', 'outside-write.txt')), 'the ".." segments collapse to the root of the jail');
    assert.ok(!fs.existsSync(path.join(tmp, 'outside-write.txt')));
    await assert.rejects(call((cb) => sftp.readFile('../' + UUID_B + '/work/secret.txt', cb)));
    await assert.rejects(call((cb) => sftp.readFile('/../../outside.txt', cb)));
    client.end();
});

test('reserved and invalid names cannot be created', async () => {
    const { client, sftp } = await connect('rw', 'rw-pass');
    await assert.rejects(call((cb) => sftp.writeFile('.env', 'x', cb)));
    await assert.rejects(call((cb) => sftp.mkdir('.pterodactyl', cb)));
    await assert.rejects(call((cb) => sftp.writeFile('a%2e%2eb', 'x', cb)));
    client.end();
});

test('symlinks cannot be created and an existing one is not followed', async (t) => {
    const { client, sftp } = await connect('rw', 'rw-pass');
    await assert.rejects(call((cb) => sftp.symlink('/etc', 'link', cb)));
    try {
        fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(storage, UUID_A, 'work', 'planted'));
    } catch {
        t.diagnostic('symlinks cannot be created on this system; skipping the planted link check');
        client.end();

        return;
    }
    await assert.rejects(call((cb) => sftp.readFile('planted', cb)));
    const names = (await call((cb) => sftp.readdir('/', cb))).map((e) => e.filename);
    assert.ok(!names.includes('planted'), 'links are hidden from listings');
    fs.unlinkSync(path.join(storage, UUID_A, 'work', 'planted'));
    client.end();
});

test('read only login cannot change anything', async () => {
    const { client, sftp } = await connect('ro', 'ro-pass');
    await assert.rejects(call((cb) => sftp.writeFile('ro.txt', 'x', cb)));
    await assert.rejects(call((cb) => sftp.mkdir('dir', cb)));
    await call((cb) => sftp.readdir('/', cb));
    client.end();
});

test('per file size, file count and total size limits are enforced', async () => {
    const { client, sftp } = await connect('rw', 'rw-pass');
    await assert.rejects(call((cb) => sftp.writeFile('big.bin', Buffer.alloc(1500), cb)), undefined, 'a file over max_file_bytes');
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 10; i++) {
        try {
            await call((cb) => sftp.writeFile(`f${i}.txt`, 'x', cb));
            accepted++;
        } catch {
            refused++;
        }
    }
    assert.ok(refused > 0, 'max_files must stop further files');
    const files = fs.readdirSync(path.join(storage, UUID_A, 'work')).length;
    assert.ok(files <= limits.max_files, `at most ${limits.max_files} files, found ${files}`);
    client.end();
});

test('shell and exec requests are refused', async () => {
    await new Promise((resolve, reject) => {
        const client = new Client();
        client.on('ready', () => {
            client.exec('id', (err) => {
                client.end();
                err ? resolve() : reject(new Error('exec must be refused'));
            });
        });
        client.on('error', reject);
        client.connect({ host: '127.0.0.1', port, username: 'rw', password: 'rw-pass' });
    });
});
