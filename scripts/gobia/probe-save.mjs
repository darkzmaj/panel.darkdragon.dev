// Scratch probe: does Ctrl+S reach the page as a prevented event, and how long does a save take from the key press?
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const baseUrl = 'http://localhost:8000';
const exe = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(`${baseUrl}/auth/login`);
await page.getByLabel('Email').fill(process.env.GOBIA_VISUAL_USER);
await page.getByLabel('Password').fill(process.env.GOBIA_VISUAL_PASSWORD);
await page.getByRole('button', { name: /^login$/i }).click();
await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
await page.goto(baseUrl + '/');
await page.locator('a.gb-server-row').first().waitFor({ timeout: 30000 });
const id = (await page.locator('a.gb-server-row').first().getAttribute('href')).split('/')[2];
await page.goto(`${baseUrl}/server/${id}/files`);
await page.waitForSelector('.gb-tree-name');
await page.evaluate(() => {
    window.__keys = [];
    document.addEventListener(
        'keydown',
        (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                const record = {
                    at: performance.now(),
                    prevented: null,
                    target: event.target.tagName + '.' + (event.target.className || '').toString().slice(0, 30),
                };
                window.__keys.push(record);
                setTimeout(() => (record.prevented = event.defaultPrevented), 0);
            }
        },
        false
    );
    const origFetch = XMLHttpRequest.prototype.open;
    window.__req = [];
    XMLHttpRequest.prototype.open = function (method, url) {
        this.addEventListener('loadstart', () =>
            window.__req.push({ at: performance.now(), method, url, phase: 'start' })
        );
        this.addEventListener('loadend', () => window.__req.push({ at: performance.now(), method, url, phase: 'end' }));
        return origFetch.apply(this, arguments);
    };
});
const name = `probe-${Date.now().toString(36)}.json`;
await page.locator('.gb-tree-row.root button').first().click();
await page.getByRole('button', { name: 'New file' }).first().click();
await page.getByLabel('File name').fill(name);
await page.getByLabel('File name').press('Enter');
await page.locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
await page.locator('.monaco-editor').first().click();
await page.keyboard.type('{"a": 1}');
await page.waitForTimeout(500);
await page.evaluate(() => (window.__req.length = 0));
const t0 = Date.now();
await page.keyboard.press('Control+s');
await page.getByText(`Saved ${name}`).first().waitFor({ timeout: 20000 });
console.log('editor focus: toast after', Date.now() - t0, 'ms');
console.log(
    JSON.stringify(
        await page.evaluate(() => ({
            keys: window.__keys,
            req: window.__req.map(
                (r) => `${Math.round(r.at)} ${r.phase} ${r.method} ${r.url.split('/files')[1] ?? r.url}`
            ),
        })),
        null,
        1
    )
);
for (let i = 0; i < 2; i++) {
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.type(' ');
    await page.waitForTimeout(300);
    await page.evaluate(() => performance.mark('probe-key'));
    const t1 = Date.now();
    await page.keyboard.press('Control+s');
    await page.getByText(`Saved ${name}`).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => {
        const o = {};
        for (const e of performance.getEntriesByType('mark'))
            if (e.name.startsWith('gobia-files:save') || e.name === 'probe-key')
                o[e.name.replace('gobia-files:', '')] = Math.round(e.startTime);
        return o;
    });
    console.log('save', i, Date.now() - t1, 'ms', JSON.stringify(m));
    await page.evaluate(() => performance.clearMarks());
}
// Focus in the explorer
await page.keyboard.type('x');
await page.locator('.gb-tree-row:not(.root) button').first().focus();
await page.evaluate(() => (window.__keys.length = 0));
await page.keyboard.press('Control+s');
await page.waitForTimeout(300);
console.log('explorer focus:', JSON.stringify(await page.evaluate(() => window.__keys)));
await browser.close();
