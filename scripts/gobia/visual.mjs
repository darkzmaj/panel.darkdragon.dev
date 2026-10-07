// Browser checks for the Gobia interface against a running development stack.
//   node scripts/gobia/visual.mjs                run: screenshots vs baselines, responsive overflow, accessibility
//   node scripts/gobia/visual.mjs --update       store the current screenshots as the new baselines
//   node scripts/gobia/visual.mjs visual|responsive|a11y   run one part
// Needs the stack from `npm run dev:gobia`. Environment:
//   GOBIA_URL (default http://localhost:8000), GOBIA_VISUAL_USER, GOBIA_VISUAL_PASSWORD (required),
//   GOBIA_BROWSER (path to a Chromium based browser; Edge and Chrome are looked up on Windows).
// Baselines live in tests/visual/baseline. A page may differ by 0.8 percent of its pixels (anti aliasing, fonts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseUrl = (process.env.GOBIA_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const user = process.env.GOBIA_VISUAL_USER ?? 'maj';
const password = process.env.GOBIA_VISUAL_PASSWORD;
const scheme = process.env.GOBIA_SCHEME === 'light' ? 'light' : 'dark';
const update = process.argv.includes('--update');
const parts = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const run = (part) => parts.length === 0 || parts.includes(part);
const baselineDir = join(root, 'tests/visual', scheme === 'light' ? 'baseline-light' : 'baseline');
const actualDir = join(root, 'tests/visual/actual');
const MAX_DIFF = 0.008;
const WIDTHS = [390, 430, 768, 1024, 1366, 1440, 1920, 2560];

const browserPath =
    process.env.GOBIA_BROWSER ??
    [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
    ].find((path) => existsSync(path));
if (!browserPath) throw new Error('No Chromium based browser found; set GOBIA_BROWSER.');
if (!password) throw new Error('Set GOBIA_VISUAL_PASSWORD (the password of the local development user).');

mkdirSync(baselineDir, { recursive: true });
mkdirSync(actualDir, { recursive: true });

// Live numbers, terminals and clocks change between runs; hide them so layout is what is compared.
const FREEZE = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  .gb-server-stats, .xterm, .gb-skeleton, [data-visual-ignore], canvas { visibility: hidden !important; }
  .gb-dot { background: currentColor !important; }
`;

const failures = [];
const note = (message) => console.log(message);
const fail = (message) => {
    failures.push(message);
    console.log(`FAIL ${message}`);
};

async function login(context) {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/auth/login`);
    await page.getByLabel('Email').fill(user);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /^login$/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30000 });
    await page.close();
}

async function settle(page) {
    await page.addStyleTag({ content: FREEZE });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
}

// Pages with live content (a terminal, resource meters) get a wider allowance; the layout is what is guarded.
const LIVE = new Map([
    ['server-console', 0.05],
    ['server-files', 0.03],
    ['server-settings', 0.03],
]);

function compare(name, buffer) {
    const actual = PNG.sync.read(buffer);
    writeFileSync(join(actualDir, `${name}.png`), buffer);
    const baselinePath = join(baselineDir, `${name}.png`);
    if (update || !existsSync(baselinePath)) {
        writeFileSync(baselinePath, buffer);
        note(`baseline stored: ${name}`);
        return;
    }
    const baseline = PNG.sync.read(readFileSync(baselinePath));
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
        fail(
            `${name}: size ${actual.width}x${actual.height} differs from baseline ${baseline.width}x${baseline.height}`
        );
        return;
    }
    const diff = new PNG({ width: actual.width, height: actual.height });
    const changed = pixelmatch(baseline.data, actual.data, diff.data, actual.width, actual.height, { threshold: 0.12 });
    const ratio = changed / (actual.width * actual.height);
    writeFileSync(join(actualDir, `${name}.diff.png`), PNG.sync.write(diff));
    if (ratio > (LIVE.get(name) ?? MAX_DIFF)) fail(`${name}: ${(ratio * 100).toFixed(2)} percent of pixels changed`);
    else note(`ok ${name} (${(ratio * 100).toFixed(2)} percent)`);
}

async function discoverServer(context) {
    const page = await context.newPage();
    await page.goto(baseUrl + '/');
    await page.waitForSelector('a[href^="/server/"]', { timeout: 30000 });
    const href = await page.locator('a[href^="/server/"]').first().getAttribute('href');
    await page.close();
    return href.split('/')[2];
}

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
try {
    if (run('visual')) {
        // Signed out: the sign in screen.
        const guest = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
        const loginPage = await guest.newPage();
        await loginPage.goto(`${baseUrl}/auth/login`);
        await settle(loginPage);
        compare('login', await loginPage.screenshot());
        await guest.close();
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    await login(context);
    const server = await discoverServer(context);
    const pages = [
        ['dashboard', '/'],
        ['server-console', `/server/${server}`],
        ['server-files', `/server/${server}/files`],
        ['server-settings', `/server/${server}/settings`],
        ['account-security', '/account'],
        ['admin-overview', '/panel'],
        ['admin-users', '/panel/users'],
        ['admin-templates', '/panel/templates'],
        ['admin-updates', '/panel/updates'],
    ];

    if (run('visual')) {
        for (const [name, path] of pages) {
            const page = await context.newPage();
            await page.goto(baseUrl + path);
            await page.waitForSelector('.gb-app', { timeout: 30000 });
            if (name === 'server-files')
                await page.waitForSelector('.gb-tree-name:not(.root)', { timeout: 30000 }).catch(() => undefined);
            await settle(page);
            compare(name, await page.screenshot());
            await page.close();
        }
        const dialog = await context.newPage();
        await dialog.goto(baseUrl + '/');
        await dialog.waitForSelector('.gb-app', { timeout: 30000 });
        await dialog.getByRole('button', { name: /create instance/i }).click();
        await dialog.waitForSelector('[role=dialog]');
        await settle(dialog);
        compare('create-instance', await dialog.screenshot());
        await dialog.close();
    }

    if (run('responsive')) {
        for (const width of WIDTHS) {
            const narrow = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
            await login(narrow);
            for (const [name, path] of pages.filter(([page]) =>
                ['dashboard', 'admin-overview', 'account-security', 'server-files'].includes(page)
            )) {
                const page = await narrow.newPage();
                await page.goto(baseUrl + path.replace(`/${server}`, `/${server}`));
                await page.waitForSelector('.gb-app', { timeout: 30000 });
                await settle(page);
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                if (overflow > 1) fail(`responsive ${name} at ${width}px overflows horizontally by ${overflow}px`);
                else note(`ok responsive ${name} at ${width}px`);
                await page.close();
            }
            await narrow.close();
        }
    }

    if (run('smoke')) {
        const check = async (label, work) => {
            try {
                await work();
                note(`ok smoke ${label}`);
            } catch (error) {
                fail(`smoke ${label}: ${String(error.message).split(/\r?\n/)[0]}`);
            }
        };
        const page = await context.newPage();
        await page.goto(baseUrl + '/');
        await page.waitForSelector('.gb-app', { timeout: 30000 });

        await check('profile menu opens with theme choices and log out', async () => {
            await page.locator('.gb-user-btn').click();
            await page.getByRole('menuitem', { name: 'Account' }).waitFor();
            await page.getByRole('group', { name: 'Theme' }).waitFor();
            await page.getByRole('menuitem', { name: 'Log out' }).waitFor();
            await page.keyboard.press('Escape');
        });
        await check('instance view menu switches the list', async () => {
            await page.getByRole('button', { name: /^All/ }).click();
            await page.getByRole('option', { name: /^You/ }).click();
            await page.getByRole('button', { name: /^You/ }).waitFor();
            await page.getByRole('button', { name: /^You/ }).click();
            await page.getByRole('option', { name: /^All/ }).click();
        });
        await check('create instance dialog offers Custom and Template', async () => {
            await page.getByRole('button', { name: /create instance/i }).click();
            await page.getByText('Configure everything manually.').waitFor();
            await page
                .getByText('Deploy using a reusable template.')
                .or(page.getByText('No enabled templates yet.'))
                .waitFor();
            await page.keyboard.press('Escape');
        });
        await check('row menu offers Open, colour and category', async () => {
            await page
                .getByRole('button', { name: /^Actions for /i })
                .first()
                .click({ force: true });
            await page.getByRole('menuitem', { name: /Change icon colour/ }).waitFor();
            await page.keyboard.press('Escape');
        });
        await check('instance opens in the shell with the instance sidebar', async () => {
            await page.locator('a.gb-server-row').first().click();
            await page.getByRole('link', { name: 'Console' }).waitFor();
            await page.getByRole('link', { name: 'All instances' }).waitFor();
        });
        await check('file workspace creates, renames and deletes live', async () => {
            const url = page.url().replace(/\/$/, '');
            await page.goto(url + '/files');
            await page.getByRole('button', { name: 'New file' }).first().click();
            const name = `smoke-${Date.now()}.txt`;
            await page.getByLabel('File name').fill(name);
            await page.getByRole('button', { name: 'Create', exact: true }).click();
            await page.locator('.gb-tree-name', { hasText: name }).waitFor();
            await page.locator('.gb-tab-name', { hasText: name }).waitFor();
            await page
                .locator('.gb-tree-row', { hasText: name })
                .first()
                .locator('button.gb-tree-more')
                .click({ force: true });
            await page.getByRole('menuitem', { name: 'Rename' }).click();
            const renamed = name.replace('smoke', 'renamed');
            await page.getByLabel('New name').fill(renamed);
            await page.getByRole('button', { name: 'Rename', exact: true }).click();
            await page.locator('.gb-tree-name', { hasText: renamed }).waitFor();
            await page.locator('.gb-tab-name', { hasText: renamed }).waitFor();
            await page
                .locator('.gb-tree-row', { hasText: renamed })
                .first()
                .locator('button.gb-tree-more')
                .click({ force: true });
            await page.getByRole('menuitem', { name: 'Delete' }).click();
            await page.getByRole('button', { name: 'Delete', exact: true }).click();
            await page.locator('.gb-tree-name', { hasText: renamed }).waitFor({ state: 'detached' });
        });
        await check('admin sidebar groups and templates tabs', async () => {
            await page.goto(baseUrl + '/panel');
            await page.getByRole('link', { name: 'Overview' }).waitFor();
            await page.goto(baseUrl + '/panel/templates');
            await page.getByRole('heading', { name: 'Templates' }).waitFor();
        });
        await page.close();

        const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
        await login(phone);
        const small = await phone.newPage();
        await small.goto(baseUrl + '/');
        await small.waitForSelector('.gb-app', { timeout: 30000 });
        await check('mobile drawer opens and closes', async () => {
            await small.getByRole('button', { name: 'Open navigation' }).click();
            await small.getByRole('link', { name: 'Account' }).waitFor({ state: 'visible' });
            await small.keyboard.press('Escape');
            await small.getByRole('button', { name: 'Open navigation' }).waitFor();
        });
        await phone.close();
    }

    if (run('a11y')) {
        const axe = readFileSync(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
        for (const [name, path] of pages) {
            const page = await context.newPage();
            await page.goto(baseUrl + path);
            await page.waitForSelector('.gb-app', { timeout: 30000 });
            await page.waitForLoadState('networkidle').catch(() => undefined);
            await page.evaluate(axe);
            const results = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
            const blocking = results.violations.filter((violation) =>
                ['critical', 'serious'].includes(violation.impact)
            );
            for (const violation of blocking) {
                fail(
                    `a11y ${name}: ${violation.id} (${violation.impact}) on ${violation.nodes.length} element(s): ${violation.help} (${violation.nodes[0]?.any?.[0]?.message ?? ''}) [${violation.nodes
                        .slice(0, 3)
                        .map((node) => node.target.join(' '))
                        .join(' | ')}]`
                );
            }
            if (blocking.length === 0) note(`ok a11y ${name} (${results.violations.length} minor or moderate)`);
            await page.close();
        }
    }
    await context.close();
} finally {
    await browser.close();
}

if (failures.length > 0) {
    console.log(`\n${failures.length} failure(s)`);
    process.exit(1);
}
console.log('\nall checks passed');
