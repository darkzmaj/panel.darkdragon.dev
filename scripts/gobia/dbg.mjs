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
await page.waitForSelector('.gb-app');
console.log(
    await page.evaluate(() => {
        const svg = document.querySelector('.gb-user-btn svg, .gb-user svg, header svg[viewBox="0 0 36 36"]');
        return svg
            ? svg.outerHTML.slice(0, 900)
            : 'none: ' + document.querySelector('.gb-user-menu, .gb-user-btn')?.outerHTML.slice(0, 600);
    })
);
await page
    .locator('header, .gb-topbar')
    .first()
    .screenshot({ path: 'tests/visual/actual/dbg-avatar.png' })
    .catch(() => undefined);
await browser.close();
