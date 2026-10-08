// Takes a screenshot of one page of the running stack, for looking at work in progress.
//   node scripts/gobia/shot.mjs <path or {id}/files> <out.png> [width=1440] [dark|light] [--click=selector ...] [--wait=ms]
// {id} is replaced by the first server's uuid. Needs GOBIA_VISUAL_USER and GOBIA_VISUAL_PASSWORD.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [target, out, width = '1440', scheme = 'dark', ...flags] = process.argv.slice(2);
const baseUrl = process.env.GOBIA_URL ?? 'http://localhost:8000';
const exe = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const mobile = Number(width) < 768;
const context = await browser.newContext({
    viewport: { width: Number(width), height: mobile ? 844 : 900 },
    colorScheme: scheme,
    isMobile: mobile,
    hasTouch: mobile,
});
const page = await context.newPage();
await page.goto(`${baseUrl}/auth/login`);
await page.getByLabel('Email').fill(process.env.GOBIA_VISUAL_USER);
await page.getByLabel('Password').fill(process.env.GOBIA_VISUAL_PASSWORD);
await page.getByRole('button', { name: /^login$/i }).click();
await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
let path = target;
if (path.includes('{id}')) {
    await page.goto(baseUrl + '/');
    await page.locator('a.gb-server-row').first().waitFor({ timeout: 30000 });
    const id = (await page.locator('a.gb-server-row').first().getAttribute('href')).split('/')[2];
    path = path.replace('{id}', id);
}
await page.goto(baseUrl + (path.startsWith('/') ? path : '/' + path));
await page.waitForSelector('.gb-app', { timeout: 30000 });
for (const flag of flags) {
    if (flag.startsWith('--click=')) await page.locator(flag.slice(8)).first().click();
    if (flag.startsWith('--wait=')) await page.waitForTimeout(Number(flag.slice(7)));
}
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
await browser.close();
