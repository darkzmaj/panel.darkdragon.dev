import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:8000/auth/login');
await page.getByLabel('Email').fill(process.env.GOBIA_VISUAL_USER);
await page.getByLabel('Password').fill(process.env.GOBIA_VISUAL_PASSWORD);
await page.getByRole('button', { name: /^login$/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/auth'));
await page.locator('li.gb-server-item').first().waitFor();
const uuid = await page.locator('li.gb-server-item').first().getAttribute('data-instance');
const id = (await page.locator('li.gb-server-item a.gb-server-row').first().getAttribute('href')).split('/')[2];
const d = ['services/mock-wings/.data/servers', uuid, 'dbgf'].join('/');
mkdirSync(d, { recursive: true });
writeFileSync(d + '/up.txt', 'x');
await page.goto(`http://localhost:8000/server/${id}/files`);
await page.waitForSelector('.gb-tree-name');
await page.evaluate(() => {
    for (const t of ['dragover', 'drop'])
        document.addEventListener(
            t,
            (e) =>
                (window.__ev ??= []).push(
                    t + ':' + e.target.className?.toString?.().slice(0, 30) + ':' + e.defaultPrevented
                ),
            false
        );
});
await page
    .locator('.gb-tree-row', { has: page.getByText('dbgf', { exact: true }) })
    .locator('button')
    .first()
    .click();
const file = page
    .locator('.gb-tree-row', { has: page.getByText('up.txt', { exact: true }) })
    .locator('button')
    .first();
await file.waitFor();
const from = await file.boundingBox();
const wrapper = await page.locator('.gb-tree').locator('xpath=..').boundingBox();
console.log(JSON.stringify({ from, wrapper }));
await page.mouse.move(from.x + 40, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(from.x + 60, from.y + 20, { steps: 3 });
await page.mouse.move(wrapper.x + wrapper.width / 2, wrapper.y + wrapper.height - 8, { steps: 10 });
await page.mouse.move(wrapper.x + wrapper.width / 2 + 2, wrapper.y + wrapper.height - 8);
await page.mouse.up();
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => window.__ev?.slice(-6))));
console.log(
    JSON.stringify(
        await page.evaluate(() =>
            [...document.querySelectorAll('.gb-tree-row button[data-path]')].map((n) => n.dataset.path)
        )
    )
);
rmSync(['services/mock-wings/.data/servers', uuid, 'dbgf'].join('/'), { recursive: true, force: true });
rmSync(['services/mock-wings/.data/servers', uuid, 'up.txt'].join('/'), { force: true });
await browser.close();
