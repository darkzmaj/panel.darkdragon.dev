// Account, Access: grant, presets, customise, edit, persist, what the person sees, the old server Users address, remove.
// Called by visual.mjs with a logged in browser context. Needs the dev guest user (access-guest@example.test).

const rows = (page) => page.locator('a.gb-server-row');

function guarded(page, check) {
    return (label, work) =>
        check(label, async () => {
            try {
                await work();
            } catch (error) {
                const name = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                await page.screenshot({ path: `tests/visual/actual/flow-${name}.png` }).catch(() => undefined);
                await page.keyboard.press('Escape').catch(() => undefined);
                await page.keyboard.press('Escape').catch(() => undefined);
                throw error;
            }
        });
}

async function chooseView(page, label) {
    await page.getByRole('button', { name: /^(All|You|Other)/ }).click();
    await page.getByRole('option', { name: new RegExp(`^${label}`) }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).waitFor();
    await page.waitForTimeout(500);
}

const onScreen = (locator) =>
    locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight && box.width > 0;
    });

export async function accessFlows({ browser, context, login, scheme, baseUrl, check: plain }) {
    const guestEmail = 'access-guest@example.test';
    const guestSecret = process.env.GOBIA_GUEST_PASSWORD ?? 'admin';
    const page = await context.newPage();
    const check = guarded(page, plain);
    await page.goto(baseUrl + '/');
    await rows(page).first().waitFor({ timeout: 30000 });
    const id = (await rows(page).first().getAttribute('href')).split('/')[2];
    const dialog = page.getByRole('dialog');

    await check('access: no Users entry in the server navigation, the old address leads to Access', async () => {
        await page.goto(`${baseUrl}/server/${id}`);
        await page.getByRole('link', { name: 'Files' }).first().waitFor();
        if ((await page.getByRole('link', { name: 'Users', exact: true }).count()) !== 0)
            throw new Error('Users is still linked');
        await page.goto(`${baseUrl}/server/${id}/users`);
        await page.waitForURL(/\/account\/access\?server=/, { timeout: 20000 });
        await page.getByRole('heading', { name: 'Access' }).first().waitFor();
    });

    await check('access: the dialog validates, selects instances and applies presets', async () => {
        await page.goto(baseUrl + '/account/access');
        await page.getByRole('button', { name: 'Grant Access' }).first().click();
        await dialog.waitFor();
        await dialog.getByLabel('Person').fill('not-an-email');
        await dialog.getByRole('alert').waitFor();
        await dialog.getByLabel('Person').fill(guestEmail);
        await dialog.getByRole('button', { name: 'Select All' }).click();
        await dialog.getByRole('button', { name: 'Clear Selection' }).click();
        if (!(await dialog.getByRole('button', { name: 'Grant Access' }).isDisabled()))
            throw new Error('grant enabled without an instance');
        await dialog.getByRole('button', { name: 'Select All' }).click();
        await dialog.getByRole('button', { name: 'Manage Server' }).click();
        if ((await dialog.getByRole('button', { name: 'Manage Server' }).getAttribute('aria-pressed')) !== 'true')
            throw new Error('preset not marked');
        await dialog.getByRole('button', { name: 'Customize Permissions' }).click();
        await dialog.getByRole('button', { name: /^Files/ }).click();
        await dialog.getByText('Delete Files').waitFor();
        await dialog.getByText('Delete Files').click();
        if ((await dialog.getByRole('button', { name: 'Manage Server' }).getAttribute('aria-pressed')) === 'true')
            throw new Error('a custom change must leave the preset');
        if (!(await onScreen(dialog.getByRole('button', { name: 'Grant Access' }))))
            throw new Error('the footer left the screen');
        await dialog.getByRole('button', { name: 'Manage Server' }).click();
    });

    await check('access: grant, still there after a reload, edit to View Only', async () => {
        await dialog.getByRole('button', { name: 'Grant Access' }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.reload();
        await page.getByText(guestEmail).first().waitFor();
        await page.getByText('Manage Server').first().waitFor();
        await page.getByRole('button', { name: /^Edit/ }).first().click();
        await dialog.getByRole('button', { name: 'View Only' }).click();
        await dialog.getByRole('button', { name: 'Save Access' }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.reload();
        await page.getByText('View Only').first().waitFor();
    });

    await check('access: the person sees the instances under Other and All, not You', async () => {
        const guest = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
        await login(guest, guestEmail, guestSecret);
        const view = await guest.newPage();
        await view.goto(baseUrl + '/');
        await rows(view).first().waitFor({ timeout: 30000 });
        const all = await rows(view).count();
        await chooseView(view, 'Other');
        if ((await rows(view).count()) !== all) throw new Error('Other differs from All');
        await chooseView(view, 'You');
        if ((await rows(view).count()) !== 0) throw new Error('shared instances appear under You');
        await guest.close();
    });

    await check('access: removing access takes it away', async () => {
        await page.goto(baseUrl + '/account/access');
        await page
            .getByRole('button', { name: /^Remove/ })
            .first()
            .click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: /^Remove/ })
            .click();
        await page.getByText(/Nobody else has access/).waitFor();
    });
    await page.close();

    const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: scheme,
        hasTouch: true,
        isMobile: true,
    });
    await login(phone);
    const small = await phone.newPage();
    await guarded(small, plain)('access: the grant dialog fits a 390 px phone', async () => {
        await small.goto(baseUrl + '/account/access');
        await small.getByRole('button', { name: 'Grant Access' }).first().click();
        const box = small.getByRole('dialog');
        await box.waitFor();
        await box.getByRole('button', { name: 'Customize Permissions' }).click();
        await box.getByRole('button', { name: /^Files/ }).click();
        const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) throw new Error(`page overflows by ${overflow}px`);
        const bounds = await box.boundingBox();
        if (bounds.x < 0 || bounds.x + bounds.width > 391 || bounds.y < 0 || bounds.y + bounds.height > 845)
            throw new Error(`dialog clipped: ${JSON.stringify(bounds)}`);
        if (!(await onScreen(box.getByRole('button', { name: 'Grant Access' }))))
            throw new Error('the footer is not on screen');
        await small.keyboard.press('Escape');
    });
    await phone.close();
}
