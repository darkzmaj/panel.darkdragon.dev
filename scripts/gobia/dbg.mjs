import { existsSync } from 'node:fs';
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
await page.waitForTimeout(2500);
const times = {};
for (const view of ['You', 'Other', 'All']) {
    await page.getByRole('button', { name: /^(All|You|Other)/ }).click();
    const option = page.getByRole('option', { name: new RegExp('^' + view) });
    await option.waitFor();
    await page.waitForTimeout(400);
    await page.evaluate(() => (window.__t0 = performance.now()));
    await option.dispatchEvent('click');
    const t = Date.now();
    await page.waitForFunction(
        (v) => document.querySelector('[aria-label="Instance views"] button')?.textContent?.startsWith(v),
        view
    );
    times[view + 'Chip'] = Math.round(await page.evaluate(() => performance.now() - window.__t0));
    await page.waitForFunction(() => document.querySelector('.gb-server-list')?.getAttribute('aria-busy') !== 'true');
    times[view] = Date.now() - t;
}
console.log(JSON.stringify(times));
await browser.close();
