// Local-development mock of Wings. Not a real daemon: no containers, files live in ./.data/<uuid>/ on the host.
//   node services/mock-wings/server.mjs        (env: WINGS_CONFIG=path to `php artisan p:node:configuration 1` output)
// Implements what the Panel calls: /api/system, server lifecycle, power, commands, logs, files, and the console websocket.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync, renameSync, cpSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '.data');
const configPath = process.env.WINGS_CONFIG ?? join(data, 'config.yml');
const config = readFileSync(configPath, 'utf8');
const pick = (key) => config.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '');
const token = pick('token'); // Panel to Wings requests carry the node token alone
const remoteToken = `${pick('token_id')}.${token}`; // Wings to Panel requests carry id.token
const port = Number((config.match(/^api:[\s\S]*?port:\s*(\d+)/m) ?? [])[1] ?? 8085);
const panel = (pick('remote') ?? 'http://localhost:8000').replace(/^['"]|['"]$/g, '');

process.on('uncaughtException', (error) => console.error('uncaught', error.message)); // a failed callback must never take the mock down
process.on('unhandledRejection', (error) => console.error('unhandled', error));

const servers = new Map(); // uuid -> { state, logs: string[], sockets: Set }
const root = (uuid) => join(data, 'servers', uuid);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function safe(uuid, p = '/') {
    const base = resolve(root(uuid));
    const full = resolve(base, '.' + (p.startsWith('/') ? p : '/' + p));
    if (full !== base && !full.startsWith(base + sep)) throw Object.assign(new Error('path escapes server root'), { status: 422 });
    return full;
}
const entry = (full, name) => {
    const s = statSync(full);
    return {
        name, created: s.birthtime.toISOString(), modified: s.mtime.toISOString(), mode: s.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--',
        mode_bits: s.isDirectory() ? '755' : '644', size: s.isDirectory() ? 4096 : s.size, directory: s.isDirectory(), file: s.isFile(),
        symlink: false, mime: s.isDirectory() ? 'inode/directory' : 'text/plain',
    };
};
// What a running server reports. `mock-stats` (dev only) overrides it so the colour thresholds of the Panel can be exercised.
const usage = (s) => ({
    memory_bytes: s.state === 'running' ? (s.override?.memory ?? 268435456) : 0,
    cpu_absolute: s.state === 'running' ? (s.override?.cpu ?? 1.5) : 0,
    disk_bytes: s.override?.disk ?? 0,
});
const statsPayload = (s) => JSON.stringify({ ...usage(s), memory_limit_bytes: 0, network: { rx_bytes: 0, tx_bytes: 0 }, state: s.state, uptime: s.state === 'running' ? Date.now() - s.started : 0 });
const pushStats = (uuid) => emit(uuid, 'stats', statsPayload(state(uuid)));
setInterval(() => { for (const uuid of servers.keys()) if (state(uuid).sockets.size) pushStats(uuid); }, 1000);
const state = (uuid) => servers.get(uuid) ?? (servers.set(uuid, { state: 'offline', logs: [], sockets: new Set(), started: 0 }), servers.get(uuid));
const emit = (uuid, event, ...args) => { for (const ws of state(uuid).sockets) ws.send(JSON.stringify({ event, args })); };
function console_(uuid, line) { const s = state(uuid); s.logs.push(line); s.logs = s.logs.slice(-200); emit(uuid, 'console output', line); }
function setState(uuid, next) { state(uuid).state = next; if (next === 'running') state(uuid).started = Date.now(); emit(uuid, 'status', next); }

function power(uuid, action) {
    if (action === 'start' || action === 'restart') {
        setState(uuid, 'starting'); console_(uuid, '[mock-wings] starting server');
        setTimeout(() => { setState(uuid, 'running'); console_(uuid, '[mock-wings] server is up (mock process, no container)'); }, 1500);
    } else {
        setState(uuid, 'stopping');
        setTimeout(() => { setState(uuid, 'offline'); console_(uuid, '[mock-wings] server stopped'); }, 800);
    }
}

async function remote(path, method, body) {
    const res = await fetch(`${panel}/api/remote${path}`, {
        method, headers: { Authorization: `Bearer ${remoteToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
    });
    await res.arrayBuffer(); // always drain the body: an unread response can abort the process when the socket closes
    return res;
}
async function install(uuid) {
    mkdirSync(root(uuid), { recursive: true });
    try {
        const res = await remote(`/servers/${uuid}/install`, 'GET');
        log('install script fetched', res.status);
        setTimeout(async () => {
            const done = await remote(`/servers/${uuid}/install`, 'POST', { successful: true, reinstall: false });
            log('install reported', done.status);
            if (done.ok) console_(uuid, '[mock-wings] install complete');
        }, 1500);
    } catch (e) { log('install callback failed', e.message); }
}

const send = (res, status, body, headers = {}) => {
    const payload = body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json' : 'text/plain', ...headers });
    res.end(payload);
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

// Browser uploads: the Panel signs a JWT URL; the mock decodes its payload (no signature check, local only) to find the server.
async function upload(req, res, url) {
    try {
        const jwt = JSON.parse(Buffer.from(url.searchParams.get('token').split('.')[1], 'base64url').toString());
        const uuid = jwt.server_uuid; const dir = safe(uuid, url.searchParams.get('directory') ?? '/');
        const boundary = '--' + req.headers['content-type'].match(/boundary=(.+)$/)[1];
        const body = await readBody(req);
        for (const part of body.toString('latin1').split(boundary).slice(1, -1)) {
            const [head, ...rest] = part.split('\r\n\r\n'); const name = head.match(/filename="([^"]*)"/)?.[1];
            if (!name) continue;
            const content = Buffer.from(rest.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1');
            mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name.split(/[\\/]/).pop()), content);
        }
        log('upload ok', uuid); return send(res, 200, '');
    } catch (e) { log('upload failed', e.message); return send(res, 400, { error: e.message }); }
}

const http = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return send(res, 204);
    if (p === '/upload/file' && req.method === 'POST') return upload(req, res, url);
    if (!p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'unauthorized' });
    try {
        const raw = await readBody(req);
        const json = () => (raw.length ? JSON.parse(raw.toString()) : {});
        if (p === '/api/system') return send(res, 200, { architecture: 'amd64', cpu_count: 8, kernel_version: 'mock', os: 'mock', version: 'mock-wings-0.1', docker_version: 'mock' });
        if (p === '/api/servers' && req.method === 'GET') return send(res, 200, [...servers].map(([uuid, s]) => ({ uuid, state: s.state })));
        if (p === '/api/servers' && req.method === 'POST') {
            const { uuid } = json(); state(uuid); log('create', uuid); install(uuid); return send(res, 202);
        }
        const m = p.match(/^\/api\/servers\/([0-9a-f-]{36})(?:\/(.*))?$/);
        if (!m) return send(res, 404, { error: 'not found' });
        const [, uuid, rest = ''] = m;
        const s = state(uuid);
        if (rest === '' && req.method === 'GET') {
            const up = s.state === 'running' ? Date.now() - s.started : 0;
            return send(res, 200, { state: s.state, is_suspended: false, utilization: { ...usage(s), uptime: up, network: { rx_bytes: 0, tx_bytes: 0 } } });
        }
        if (rest === '' && req.method === 'DELETE') { servers.delete(uuid); rmSync(root(uuid), { recursive: true, force: true }); return send(res, 204); }
        if (rest === 'mock-stats') { s.override = json(); pushStats(uuid); return send(res, 204); }
        if (rest === 'sync') return send(res, 204);
        if (rest === 'reinstall') { install(uuid); return send(res, 202); }
        if (rest === 'power') { power(uuid, json().action); return send(res, 202); }
        if (rest === 'commands') { for (const c of json().commands ?? []) console_(uuid, `> ${c}`); return send(res, 204); }
        if (rest === 'logs') return send(res, 200, { data: s.logs });
        if (rest === 'files/list-directory') {
            const dir = safe(uuid, url.searchParams.get('directory') ?? '/');
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const list = readdirSync(dir).map((n) => entry(join(dir, n), n)).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
            return send(res, 200, list);
        }
        if (rest === 'files/contents') {
            const f = safe(uuid, url.searchParams.get('file') ?? '');
            if (!existsSync(f) || statSync(f).isDirectory()) return send(res, 404, { error: 'file not found' });
            const buf = readFileSync(f);
            return send(res, 200, buf, { 'Content-Length': buf.length, 'Content-Type': 'text/plain' });
        }
        if (rest === 'files/write') { const f = safe(uuid, url.searchParams.get('file') ?? ''); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, raw); return send(res, 204); }
        if (rest === 'files/create-directory') { const b = json(); mkdirSync(join(safe(uuid, b.path), b.name), { recursive: true }); return send(res, 204); }
        if (rest === 'files/rename') { const b = json(); for (const f of b.files) renameSync(safe(uuid, `${b.root}/${f.from}`), safe(uuid, `${b.root}/${f.to}`)); return send(res, 204); }
        if (rest === 'files/delete') { const b = json(); for (const f of b.files) rmSync(safe(uuid, `${b.root}/${f}`), { recursive: true, force: true }); return send(res, 204); }
        if (rest === 'files/copy') {
            const f = safe(uuid, json().location); const ext = f.match(/(\.[^./\\]+)?$/)[0];
            cpSync(f, `${f.slice(0, f.length - ext.length)} copy${ext}`, { recursive: true }); return send(res, 204);
        }
        if (rest === 'files/chmod') return send(res, 204);
        if (/^(files\/(compress|decompress|pull)|archive|backup|transfer)/.test(rest)) return send(res, 501, { error: 'not implemented by mock wings' });
        return send(res, 404, { error: `unhandled ${req.method} ${p}` });
    } catch (e) { log('error', req.method, p, e.message); return send(res, e.status ?? 500, { error: e.message }); }
});

// Console websocket: the Panel hands the browser a JWT; the mock accepts any token (local development only).
const wss = new WebSocketServer({ noServer: true });
http.on('upgrade', (req, socket, head) => {
    const m = new URL(req.url, 'http://x').pathname.match(/^\/api\/servers\/([0-9a-f-]{36})\/ws$/);
    if (!m) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
        const uuid = m[1]; const s = state(uuid);
        ws.on('message', (raw) => {
            const { event, args = [] } = JSON.parse(raw.toString());
            if (event === 'auth') { ws.send(JSON.stringify({ event: 'auth success', args: [] })); s.sockets.add(ws); ws.send(JSON.stringify({ event: 'status', args: [s.state] })); }
            if (event === 'send logs') for (const l of s.logs) ws.send(JSON.stringify({ event: 'console output', args: [l] }));
            if (event === 'send stats') ws.send(JSON.stringify({ event: 'stats', args: [statsPayload(s)] }));
            if (event === 'set state') power(uuid, args[0]);
            if (event === 'send command') console_(uuid, `> ${args[0]}`);
        });
        ws.on('close', () => s.sockets.delete(ws));
    });
});

mkdirSync(join(data, 'servers'), { recursive: true });
for (const uuid of readdirSync(join(data, 'servers'))) state(uuid); // servers survive restarts, state resets to offline
http.listen(port, '0.0.0.0', () => log(`mock wings listening on :${port}, panel ${panel}`));
