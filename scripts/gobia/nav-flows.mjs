// Server navigation: Startup is a tab of Settings and Network is called Ports, with the old addresses still working.
// Called by visual.mjs with a logged in browser context.

export async function navFlows({ context, baseUrl, check: plain }) {
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
    await page.goto(baseUrl + '/');
    const links = page.locator('a.gb-server-row');
    await links.first().waitFor({ timeout: 30000 });
    const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
    const ids = hrefs.map((href) => href.split('/')[2]);
    const names = await page.locator('li.gb-server-item .gb-server-title strong').allInnerTexts();
    const sidebar = page.locator('.gb-sidebar, aside, nav').first();
    const tab = (name) => page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name, exact: true });
    const path = () => new URL(page.url()).pathname;

    await check('navigation: Settings has General and Startup tabs, Startup is no longer in the sidebar', async () => {
        await page.goto(`${baseUrl}/server/${ids[0]}/settings`);
        await tab('General').waitFor({ timeout: 20000 });
        await tab('Startup').waitFor();
        if ((await tab('General').getAttribute('aria-current')) !== 'page')
            throw new Error('General is not the open tab');
        await page.getByText('SFTP Details').first().waitFor();
        const side = page.locator('.gb-nav-item');
        const labels = (await side.allInnerTexts()).map((text) => text.trim());
        if (labels.includes('Startup')) throw new Error('Startup is still a sidebar entry');
        if (labels.includes('Network')) throw new Error('Network is still a sidebar entry');
        if (!labels.includes('Ports')) throw new Error('Ports is missing from the sidebar');
        if (!labels.includes('Settings')) throw new Error('Settings is missing from the sidebar');
    });

    await check(
        'navigation: the Startup tab holds the command, Docker image and variables, and keeps Settings active',
        async () => {
            await tab('Startup').click();
            await page.waitForURL(`**/server/${ids[0]}/settings/startup`, { timeout: 20000 });
            await page.getByText('Startup Command').first().waitFor({ timeout: 20000 });
            await page.getByText('Docker Image').first().waitFor();
            if ((await tab('Startup').getAttribute('aria-current')) !== 'page')
                throw new Error('Startup is not the open tab');
            const active = (await page.locator('.gb-nav-item.active').allInnerTexts()).map((text) => text.trim());
            if (!active.includes('Settings')) throw new Error('Settings is not highlighted on the Startup tab');
            if ((await page.getByText('SFTP Details').count()) > 0)
                throw new Error('General content leaked into Startup');
        }
    );

    await check('navigation: Back, Forward and refresh keep the tab', async () => {
        await tab('General').click();
        await page.waitForURL(`**/server/${ids[0]}/settings`, { timeout: 20000 });
        await page.goBack();
        await page.waitForURL(`**/server/${ids[0]}/settings/startup`, { timeout: 20000 });
        await page.getByText('Startup Command').first().waitFor({ timeout: 20000 });
        await page.goForward();
        await page.waitForURL(`**/server/${ids[0]}/settings`, { timeout: 20000 });
        await tab('Startup').click();
        await page.reload();
        await tab('Startup').waitFor({ timeout: 20000 });
        if (!path().endsWith('/settings/startup')) throw new Error('refresh lost the tab');
        await page.getByText('Startup Command').first().waitFor({ timeout: 20000 });
    });

    await check('navigation: the old Startup address opens Settings, Startup', async () => {
        await page.goto(`${baseUrl}/server/${ids[0]}/startup`);
        await page.waitForURL(`**/server/${ids[0]}/settings/startup`, { timeout: 20000 });
        await page.getByText('Startup Command').first().waitFor({ timeout: 20000 });
    });

    await check('navigation: the searchable server switcher keeps the Startup tab', async () => {
        if (!ids[1]) return;
        await page.goto(`${baseUrl}/server/${ids[0]}/settings/startup`);
        await page.getByText('Startup Command').first().waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Switch instance' }).click();
        await page.getByRole('combobox', { name: 'Search instances' }).fill(names[1].slice(0, 6));
        await page.getByRole('option', { name: new RegExp(names[1]) }).click();
        await page.waitForURL(`**/server/${ids[1]}/settings/startup`, { timeout: 20000 });
        await tab('Startup').waitFor({ timeout: 20000 });
        if ((await tab('Startup').getAttribute('aria-current')) !== 'page') throw new Error('the tab was not kept');
    });

    await check('navigation: Ports replaces Network in the heading and sidebar and keeps allocations', async () => {
        await page.goto(`${baseUrl}/server/${ids[0]}/ports`);
        await page.getByRole('heading', { name: 'Ports', exact: true }).waitFor({ timeout: 20000 });
        if ((await page.getByRole('heading', { name: 'Network', exact: true }).count()) > 0)
            throw new Error('the Network heading is still there');
        await page
            .getByText(/allocations|Primary/i)
            .first()
            .waitFor({ timeout: 20000 });
        const active = (await page.locator('.gb-nav-item.active').allInnerTexts()).map((text) => text.trim());
        if (!active.includes('Ports')) throw new Error('Ports is not highlighted');
    });

    await check('navigation: the old Network address opens Ports', async () => {
        await page.goto(`${baseUrl}/server/${ids[0]}/network`);
        await page.waitForURL(`**/server/${ids[0]}/ports`, { timeout: 20000 });
        await page.getByRole('heading', { name: 'Ports', exact: true }).waitFor({ timeout: 20000 });
    });

    await check('navigation: the switcher keeps Ports and the admin Network section is unchanged', async () => {
        if (ids[1]) {
            await page.getByRole('button', { name: 'Switch instance' }).click();
            await page.getByRole('combobox', { name: 'Search instances' }).fill(names[1].slice(0, 6));
            await page.getByRole('option', { name: new RegExp(names[1]) }).click();
            await page.waitForURL(`**/server/${ids[1]}/ports`, { timeout: 20000 });
        }
        await page.goto(`${baseUrl}/panel`);
        await page.getByText('Network', { exact: true }).first().waitFor({ timeout: 20000 });
        for (const entry of ['Nodes & Instances', 'Locations', 'Templates']) {
            if ((await page.getByRole('link', { name: entry }).count()) === 0)
                throw new Error(`admin entry ${entry} is gone`);
        }
    });

    await page.close();
}
