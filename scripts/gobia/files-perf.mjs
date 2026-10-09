// How smooth the file explorer is with a big folder: 600 files, measured in a real browser.
//   GOBIA_VISUAL_USER=... GOBIA_VISUAL_PASSWORD=... node scripts/gobia/files-perf.mjs
// Prints the average and the worst time from a click (or a key) to the next painted frame, the long tasks during a
// selection sweep, and what a refresh that changed nothing costs.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseUrl = process.env.GOBIA_URL ?? 'http://localhost:8000';
const exe = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${baseUrl}/auth/login`);
await page.getByLabel('Email').fill(process.env.GOBIA_VISUAL_USER);
await page.getByLabel('Password').fill(process.env.GOBIA_VISUAL_PASSWORD);
await page.getByRole('button', { name: /^login$/i }).click();
await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
await page.goto(baseUrl + '/');
const row = page.locator('li.gb-server-item').first();
await row.waitFor();
const uuid = await row.getAttribute('data-instance');
const id = (await row.locator('a.gb-server-row').getAttribute('href')).split('/')[2];
const folder = join(root, 'services/mock-wings/.data/servers', uuid, 'perf-big');
mkdirSync(folder, { recursive: true });
for (let index = 0; index < 600; index++)
    writeFileSync(join(folder, `file-${String(index).padStart(3, '0')}.txt`), 'x');
try {
    await page.addInitScript(() => {
        window.__boot = [];
        new PerformanceObserver((list) =>
            window.__boot.push(
                ...list.getEntries().map((entry) => [Math.round(entry.startTime), Math.round(entry.duration)])
            )
        ).observe({ entryTypes: ['longtask'] });
    });
    await page.goto(`${baseUrl}/server/${id}/files`);
    await page.waitForSelector('.gb-tree-name');
    await page.waitForTimeout(3000);
    const boot = await page.evaluate(() => window.__boot);
    const expandStart = Date.now();
    await page
        .locator('.gb-tree-row', { has: page.getByText('perf-big', { exact: true }) })
        .locator('button')
        .first()
        .click();
    await page.locator('.gb-tree-name', { hasText: 'file-599.txt' }).waitFor({ timeout: 60000 });
    const expandMs = Date.now() - expandStart;
    await page.evaluate(() => {
        window.__long = [];
        new PerformanceObserver((list) =>
            window.__long.push(...list.getEntries().map((entry) => entry.duration))
        ).observe({ entryTypes: ['longtask'] });
    });
    const frame = (script) => page.evaluate(script);
    // Select 25 different rows with the mouse: click to the next painted frame.
    const clicks = [];
    for (let index = 0; index < 25; index++) {
        const target = page
            .locator('.gb-tree-row', {
                has: page.getByText(`file-${String(index * 3).padStart(3, '0')}.txt`, { exact: true }),
            })
            .locator('button')
            .first();
        await target.scrollIntoViewIfNeeded();
        const handle = await target.elementHandle();
        clicks.push(
            await page.evaluate(
                (node) =>
                    new Promise((resolveFrame) => {
                        const start = performance.now();
                        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
                        requestAnimationFrame(() =>
                            requestAnimationFrame(() => resolveFrame(performance.now() - start))
                        );
                    }),
                handle
            )
        );
    }
    // Arrow keys down the list.
    await page.locator('.gb-tree-row:not(.root) button').nth(5).focus();
    const keys = [];
    for (let index = 0; index < 25; index++) {
        keys.push(
            await page.evaluate(
                () =>
                    new Promise((resolveFrame) => {
                        const start = performance.now();
                        document.activeElement.dispatchEvent(
                            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
                        );
                        requestAnimationFrame(() =>
                            requestAnimationFrame(() => resolveFrame(performance.now() - start))
                        );
                    })
            )
        );
    }
    // A refresh that finds nothing changed (the explorer does this every twenty seconds and when the tab is focused).
    const refresh = await frame(
        () =>
            new Promise((resolveFrame) => {
                const start = performance.now();
                window.dispatchEvent(new Event('focus'));
                setTimeout(
                    () =>
                        requestAnimationFrame(() =>
                            requestAnimationFrame(() => resolveFrame(performance.now() - start))
                        ),
                    1500
                );
            })
    );
    const long = await page.evaluate(() => window.__long);
    const stat = (values) => ({
        avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
        worst: Math.round(Math.max(...values)),
    });
    console.log(
        JSON.stringify({
            rows: 600,
            bootLongTasks: boot,
            expandMs,
            selectClick: stat(clicks),
            arrowKey: stat(keys),
            refreshIdleMs: Math.round(refresh),
            longTasks: long.filter((duration) => duration > 50).length,
            longestTaskMs: Math.round(Math.max(0, ...long)),
        })
    );
} finally {
    rmSync(folder, { recursive: true, force: true });
    await browser.close();
}
void readdirSync;
