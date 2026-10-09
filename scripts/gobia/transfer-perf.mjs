// How long server to server transfers take through the Panel, measured request by request against the development mock
// Wings (so it measures the Panel, its HTTP client and the mock, not a real node or network).
//   GOBIA_VISUAL_USER=... GOBIA_VISUAL_PASSWORD=... node scripts/gobia/transfer-perf.mjs [label]
// Prints, per case, the wall time of the request from the browser and the stage timings the Panel reports.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseUrl = process.env.GOBIA_URL ?? 'http://localhost:8000';
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${baseUrl}/auth/login`);
await page.getByLabel('Email').fill(process.env.GOBIA_VISUAL_USER);
await page.getByLabel('Password').fill(process.env.GOBIA_VISUAL_PASSWORD);
await page.getByRole('button', { name: /^login$/i }).click();
await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
await page.goto(baseUrl + '/');
const rows = page.locator('li.gb-server-item');
await rows.first().waitFor();
const [a, b] = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-instance')));
const disk = (uuid, ...parts) => join(root, 'services/mock-wings/.data/servers', uuid, ...parts);
const dir = `tperf-${Date.now().toString(36)}`;
mkdirSync(disk(a, dir, 'folder', 'sub'), { recursive: true });
mkdirSync(disk(b, dir, 'in'), { recursive: true });
const small = Buffer.from('{"hello":"world","n":1}\n');
const binary = randomBytes(5 * 1024 * 1024);
const big = randomBytes(40 * 1024 * 1024);
writeFileSync(disk(a, dir, 'small.json'), small);
writeFileSync(disk(a, dir, 'plugin.bin'), binary);
writeFileSync(disk(a, dir, 'server.jar'), big);
for (let index = 0; index < 20; index++) writeFileSync(disk(a, dir, 'folder', index % 2 ? 'sub' : '.', `f${index}.yml`), `key${index}: ${index}\n`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const xsrf = decodeURIComponent((await context.cookies(baseUrl)).find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? '');
const send = async (items, mode, extra = {}) => {
    const started = Date.now();
    const response = await page.request.post(`${baseUrl}/api/client/extensions/gobia-files/transfers`, {
        headers: { 'X-XSRF-TOKEN': xsrf, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        data: { source: a, destination: b, directory: `/${dir}/in`, items, mode, conflict: 'replace', ...extra },
        timeout: 600000,
    });
    const body = await response.json().catch(() => ({}));
    return { ms: Date.now() - started, status: response.status(), body };
};

const results = {};
const label = process.argv[2] ?? 'run';
try {
    const cases = [
        ['small file copy', [`/${dir}/small.json`], 'copy', disk(a, dir, 'small.json'), disk(b, dir, 'in', 'small.json')],
        ['5 MiB binary copy', [`/${dir}/plugin.bin`], 'copy', disk(a, dir, 'plugin.bin'), disk(b, dir, 'in', 'plugin.bin')],
        ['40 MiB jar copy', [`/${dir}/server.jar`], 'copy', disk(a, dir, 'server.jar'), disk(b, dir, 'in', 'server.jar')],
    ];
    for (const [name, items, mode, source, target] of cases) {
        const run = await send(items, mode);
        const same = existsSync(target) && sha(source) === sha(target);
        results[name] = { ms: run.ms, http: run.status, item: run.body.items?.[0]?.status, reason: run.body.items?.[0]?.reason, identical: same, stages: run.body.timings ?? null };
    }
    const folder = await send([`/${dir}/folder`], 'copy');
    results['folder of 20 small files copy'] = { ms: folder.ms, http: folder.status, item: folder.body.items?.[0]?.status, copied: folder.body.items?.[0]?.copied, stages: folder.body.timings ?? null };
    // Moves: the source must be gone afterwards, the destination identical.
    const original = sha(disk(a, dir, 'small.json'));
    rmSync(disk(b, dir, 'in', 'small.json'), { force: true });
    const move = await send([`/${dir}/small.json`], 'move');
    results['small file move'] = { ms: move.ms, http: move.status, item: move.body.items?.[0]?.status, sourceGone: !existsSync(disk(a, dir, 'small.json')), destinationIdentical: existsSync(disk(b, dir, 'in', 'small.json')) && sha(disk(b, dir, 'in', 'small.json')) === original, stages: move.body.timings ?? null };
    const bigMove = await send([`/${dir}/server.jar`], 'move');
    results['40 MiB jar move'] = { ms: bigMove.ms, http: bigMove.status, item: bigMove.body.items?.[0]?.status, sourceGone: !existsSync(disk(a, dir, 'server.jar')), stages: bigMove.body.timings ?? null };
} finally {
    for (const uuid of [a, b]) rmSync(disk(uuid, dir), { recursive: true, force: true });
    await browser.close();
}
console.log(JSON.stringify({ label, results }, null, 2));
