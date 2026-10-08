// Admin navigation: the merged workspaces (Nodes and Instances, Eggs and Mounts, Settings), recent activity in the
// overview, the old addresses and the footer. Called by visual.mjs with a logged in browser context.

export async function adminFlows({ browser, context, login, scheme, baseUrl, check: plain }) {
    const page = await context.newPage();
    const check = (label, work) =>
        plain(label, async () => {
            try {
                await work();
            } catch (error) {
                const name = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                await page.screenshot({ path: `tests/visual/actual/flow-${name}.png` }).catch(() => undefined);
                throw error;
            }
        });
    const path = () => new URL(page.url()).pathname;
    const tabs = (name) => page.getByRole('navigation', { name });
    const tab = (group, label) => tabs(group).getByRole('link', { name: label, exact: true });
    const go = async (to) => {
        await page.goto(baseUrl + to);
        await page.locator('.gb-app').waitFor({ timeout: 30000 });
        await page.waitForLoadState('networkidle').catch(() => undefined);
    };
    const current = async (group, label) => {
        await tab(group, label).waitFor();
        if ((await tab(group, label).getAttribute('aria-current')) !== 'page')
            throw new Error(`${label} is not the active tab`);
    };

    await check(
        'admin: the sidebar has the final structure and no Activity, Tags, Extensions or API Keys entry',
        async () => {
            await go('/panel');
            const side = page.locator('.gb-sidebar, aside').first();
            for (const name of [
                'Overview',
                'Nodes & Instances',
                'Locations',
                'Templates',
                'Eggs & Mounts',
                'Settings',
                'Updates',
            ]) {
                await side.getByRole('link', { name, exact: true }).first().waitFor();
            }
            for (const name of ['Activity', 'Tags', 'Extensions', 'API Keys', 'Nodes', 'Instances', 'Mounts', 'Eggs']) {
                if ((await side.getByRole('link', { name, exact: true }).count()) !== 0)
                    throw new Error(`${name} is still a sidebar entry`);
            }
        }
    );

    await check('admin: Nodes and Instances are tabs of one page and switch without a reload', async () => {
        await go('/panel/nodes');
        await current('Nodes & Instances', 'Nodes');
        await page.evaluate(() => (window.__gobiaMark = 1));
        await tab('Nodes & Instances', 'Instances').click();
        await page.waitForURL('**/panel/servers');
        await current('Nodes & Instances', 'Instances');
        if ((await page.evaluate(() => window.__gobiaMark)) !== 1) throw new Error('the page reloaded');
        const active = await page.locator('a.gb-nav-item.active', { hasText: 'Nodes & Instances' }).count();
        if (active !== 1) throw new Error('the sidebar entry is not highlighted on the Instances tab');
        await page.goBack();
        await page.waitForURL('**/panel/nodes');
        await current('Nodes & Instances', 'Nodes');
        await page.goForward();
        await page.waitForURL('**/panel/servers');
        await page.reload();
        await current('Nodes & Instances', 'Instances');
    });

    await check('admin: Eggs and Mounts are tabs, the egg importer stays, the sidebar stays highlighted', async () => {
        await go('/panel/eggs');
        await current('Eggs & Mounts', 'Eggs');
        await page
            .getByRole('button', { name: /import/i })
            .first()
            .waitFor();
        await tab('Eggs & Mounts', 'Mounts').click();
        await page.waitForURL('**/panel/mounts');
        await current('Eggs & Mounts', 'Mounts');
        if ((await page.locator('a.gb-nav-item.active', { hasText: 'Eggs & Mounts' }).count()) !== 1)
            throw new Error('sidebar not highlighted');
    });

    await check('admin: every Settings section is a tab with its own address that survives a refresh', async () => {
        const sections = [
            ['General', '/panel/settings'],
            ['Mail', '/panel/settings/mail'],
            ['Advanced', '/panel/settings/advanced'],
            ['API Keys', '/panel/api'],
            ['Extensions', '/panel/extensions'],
            ['Tags', '/panel/tags'],
        ];
        await go('/panel/settings');
        for (const [label, to] of sections) {
            await tab('Settings', label).click();
            await page.waitForURL('**' + to);
            await current('Settings', label);
            await page.reload();
            await current('Settings', label);
            if (path() !== to) throw new Error(`${label} moved to ${path()}`);
            if ((await page.locator('a.gb-nav-item.active', { hasText: 'Settings' }).count()) !== 1)
                throw new Error(`${label}: sidebar not highlighted`);
        }
        await page
            .getByRole('button', { name: /create|new/i })
            .first()
            .waitFor();
    });

    await check(
        'admin: the overview shows real recent activity on its own and View all opens the full log',
        async () => {
            await go('/panel');
            await page.getByRole('region', { name: 'Recent Activity' }).waitFor({ timeout: 30000 });
            await page.getByRole('region', { name: 'Recent Activity' }).getByRole('link', { name: 'View all' }).click();
            await page.waitForURL('**/panel/activity');
            await page.getByRole('heading', { name: 'Activity' }).first().waitFor();
        }
    );

    await check('admin: old addresses still work', async () => {
        for (const to of [
            '/panel/servers',
            '/panel/mounts',
            '/panel/activity',
            '/panel/tags',
            '/panel/extensions',
            '/panel/api',
            '/panel/eggs',
        ]) {
            await go(to);
            if (path() !== to) throw new Error(`${to} redirected to ${path()}`);
            await page.locator('h1, h2').first().waitFor();
        }
    });

    await check(
        'footer: no Account column, Cryvex logo fades in on hover, Discord opens gobia.cloud/discord',
        async () => {
            await go('/panel/settings');
            const footer = page.locator('footer.gb-footer');
            await footer.scrollIntoViewIfNeeded();
            if ((await footer.getByText('ACCOUNT', { exact: true }).count()) !== 0)
                throw new Error('the Account column is still there');
            if (
                (await footer.getByRole('link', { name: 'Login' }).count()) +
                    (await footer.getByRole('link', { name: 'Register' }).count()) !==
                0
            )
                throw new Error('login links remain');
            const cryvex = footer.getByRole('link', { name: /Cryvex/ });
            if ((await cryvex.getAttribute('href')) !== 'https://cryvex.org') throw new Error('wrong Cryvex address');
            const logo = cryvex.locator('img:visible').first();
            const rest = await logo.evaluate((element) => getComputedStyle(element).opacity);
            if (rest !== '0.5') throw new Error(`resting opacity ${rest}`);
            await cryvex.hover();
            await page.waitForTimeout(700);
            const hover = await logo.evaluate((element) => getComputedStyle(element).opacity);
            if (hover !== '1') throw new Error(`hover opacity ${hover}`);
            const discord = footer.getByRole('link', { name: /Discord/ });
            if ((await discord.getAttribute('href')) !== 'https://gobia.cloud/discord')
                throw new Error('wrong Discord address');
            const box = await discord.boundingBox();
            const copy = await footer.getByText('All Rights Reserved').boundingBox();
            if (box.x < copy.x + copy.width) throw new Error('the Discord button is not on the right');
            await footer.screenshot({ path: `tests/visual/actual/footer-${scheme}.png` });
        }
    );
    await page.close();

    const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: scheme,
        hasTouch: true,
        isMobile: true,
    });
    await login(phone);
    const small = await phone.newPage();
    await plain('footer: the footer fits a 390 px phone and the admin tabs do not overflow', async () => {
        await small.goto(baseUrl + '/panel/settings');
        await small.locator('footer.gb-footer').scrollIntoViewIfNeeded();
        const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) throw new Error(`page overflows by ${overflow}px`);
        for (const name of [/Cryvex/, /Discord/]) {
            const link = small.locator('footer.gb-footer').getByRole('link', { name });
            const box = await link.boundingBox();
            if (!box || box.x < 0 || box.x + box.width > 391) throw new Error(`${name} is clipped`);
        }
        await small.locator('footer.gb-footer').screenshot({ path: `tests/visual/actual/footer-mobile-${scheme}.png` });
    });
    await phone.close();
}
