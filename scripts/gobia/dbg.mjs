import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
const baseUrl = 'http://localhost:8000';
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 200)));
await page.addInitScript(() => localStorage.removeItem('gobia-files:dual'));
await page.goto(`${baseUrl}/auth/login`);
await page.getByLabel('Email').fill(process.env.GOBIA_VISUAL_USER);
await page.getByLabel('Password').fill(process.env.GOBIA_VISUAL_PASSWORD);
await page.getByRole('button', { name: /^login$/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/auth'));
await page.goto(baseUrl + '/');
const rows = page.locator('li.gb-server-item');
await rows.first().waitFor();
const uuids = await rows.evaluateAll((n) => n.map((x) => x.getAttribute('data-instance')));
const id = (await rows.first().locator('a.gb-server-row').getAttribute('href')).split('/')[2];
const disk = (u, ...p) => ['services/mock-wings/.data/servers', u, ...p].join('/');
mkdirSync(disk(uuids[1], 'dbgdir', 'inbox'), { recursive: true });
mkdirSync(disk(uuids[0], 'dbgdir'), { recursive: true });
writeFileSync(disk(uuids[0], 'dbgdir', 'x.bin'), Buffer.from([0, 1, 2, 255]));
await page.goto(`${baseUrl}/server/${id}/files`);
await page.waitForSelector('.gb-tree-name');
await page.getByRole('button', { name: 'Dual servers' }).click();
await page.locator('.gb-explorer [data-pane="b"] .gb-tree-row.root').waitFor();
const ex = (p) => page.locator(`.gb-explorer [data-pane="${p}"]`);
const row = (p, n) =>
    ex(p)
        .locator('.gb-tree-row', { has: page.getByText(n, { exact: true }) })
        .first();
await page.evaluate(() => {
    for (const t of ['dragstart', 'dragover', 'drop'])
        document.addEventListener(
            t,
            (e) => {
                (window.__ev ??= []).push(
                    t +
                        ':' +
                        [...e.dataTransfer.types].join(',') +
                        ':' +
                        (e.target.closest?.('.gb-tree-row')?.innerText ?? '').slice(0, 12) +
                        ':' +
                        e.dataTransfer.dropEffect +
                        ':' +
                        e.defaultPrevented
                );
            },
            false
        );
});
await row('a', 'dbgdir').locator('button').first().click();
await row('b', 'dbgdir').locator('button').first().click();
await row('b', 'inbox').waitFor();
await row('a', 'x.bin').waitFor();
await row('a', 'x.bin').locator('button').first().dragTo(row('b', 'inbox'));
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(() => ({ ev: window.__ev?.slice(0, 12), marks: window.__gobiaFiles }))));
await page.screenshot({ path: 'tests/visual/actual/dbg.png' });
rmSync(disk(uuids[0], 'dbgdir'), { recursive: true, force: true });
rmSync(disk(uuids[1], 'dbgdir'), { recursive: true, force: true });
await browser.close();
