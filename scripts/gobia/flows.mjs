// Interaction regressions for the dashboard (view, category and search filters, categories, icon colour) and the file
// workspace (create, rename, move, delete, search and replace, structured validation, outside changes).
// Called by visual.mjs with a logged in browser context; every step is a named check that reports through `check`.

const stamp = () => Date.now().toString(36);

/** A check that leaves a screenshot of the page next to the baselines when it fails. */
function withScreenshot(page, check) {
    return (label, work) =>
        check(label, async () => {
            try {
                await work();
            } catch (error) {
                const name = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                await page.screenshot({ path: `tests/visual/actual/flow-${name}.png` }).catch(() => undefined);
                // A dialog left open by the failed step must not fail every step after it.
                await page.keyboard.press('Escape').catch(() => undefined);
                await page.keyboard.press('Escape').catch(() => undefined);
                throw error;
            }
        });
}

/** The number a view option of the dashboard shows after its name: "All · 4" gives 4. */
async function viewCount(page, label) {
    await page.getByRole('button', { name: /^(All|You|Other)/ }).click();
    const text = await page.getByRole('option', { name: new RegExp(`^${label}`) }).innerText();
    await page.keyboard.press('Escape');
    return Number(/·\s*(\d+)/.exec(text)?.[1] ?? NaN);
}

async function chooseView(page, label) {
    await page.getByRole('button', { name: /^(All|You|Other)/ }).click();
    await page.getByRole('option', { name: new RegExp(`^${label}`) }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).waitFor();
}

const rows = (page) => page.locator('a.gb-server-row');

async function settleList(page) {
    await page.waitForTimeout(500);
    await page
        .locator('.gb-skeleton')
        .first()
        .waitFor({ state: 'detached' })
        .catch(() => undefined);
}

export async function dashboardFlows({ context, baseUrl, check: plain }) {
    const page = await context.newPage();
    const check = withScreenshot(page, plain);
    await page.goto(baseUrl + '/');
    await page.waitForSelector('.gb-app', { timeout: 30000 });
    await rows(page).first().waitFor({ timeout: 30000 });

    await check('filters: every view lists exactly the count it shows', async () => {
        for (const label of ['All', 'You', 'Other']) {
            const count = await viewCount(page, label);
            await chooseView(page, label);
            await settleList(page);
            const shown = await rows(page).count();
            if (count <= 25 && shown !== count) throw new Error(`${label}: menu says ${count}, list has ${shown}`);
        }
        await chooseView(page, 'All');
    });

    await check('filters: search composes with the view', async () => {
        await settleList(page);
        const name = (await rows(page).first().locator('.gb-server-name, strong, h3').first().innerText()).trim();
        const term = name.slice(0, Math.min(6, name.length)).toLowerCase();
        for (const label of ['All', 'You']) {
            await chooseView(page, label);
            await page.getByLabel('Search instances').fill(term);
            await settleList(page);
            const texts = await rows(page).allInnerTexts();
            if (label === 'All' && texts.length === 0) throw new Error('search found nothing for a visible name');
            for (const text of texts) {
                if (!text.toLowerCase().includes(term))
                    throw new Error(`"${term}" is not in a listed row: ${text.slice(0, 60)}`);
            }
        }
        await page.getByLabel('Search instances').fill('zzz-no-such-instance');
        await settleList(page);
        await page.getByText('No instances match this view.').waitFor();
        await page.getByRole('button', { name: 'Clear search' }).click();
        await settleList(page);
        await chooseView(page, 'All');
    });

    const category = `Smoke ${stamp()}`;
    await check('categories: create with an instance, filter by it, survive a reload', async () => {
        await page.getByRole('button', { name: 'Edit categories' }).click();
        await page.getByLabel('Category name').fill(category);
        await page.locator('.gb-check-row input[type=checkbox]').first().check();
        await page.getByRole('button', { name: 'Create category' }).click();
        await page.getByRole('button', { name: 'Close' }).click();
        await page.getByRole('button', { name: category, exact: true }).click();
        await settleList(page);
        if ((await rows(page).count()) !== 1) throw new Error('the category should list its one instance');
        await page.reload();
        await page.getByRole('button', { name: category, exact: true }).waitFor();
    });

    await check('categories: rename shows at once and a view change keeps the category', async () => {
        await page.getByRole('button', { name: 'Edit categories' }).click();
        await page.locator('.gb-cat-name', { hasText: category }).click();
        await page.getByLabel('Category name').fill(category + ' B');
        await page.getByRole('button', { name: 'Save category' }).click();
        await page.getByRole('button', { name: 'Close' }).click();
        await page.getByRole('button', { name: category + ' B', exact: true }).waitFor();
        await page.getByRole('button', { name: category + ' B', exact: true }).click();
        await chooseView(page, 'You');
        await page.getByRole('button', { name: category + ' B', exact: true }).waitFor();
        await chooseView(page, 'All');
    });

    await check('categories: delete leaves the category and returns to every instance', async () => {
        await page.getByRole('button', { name: 'Edit categories' }).click();
        await page.locator('.gb-cat-name', { hasText: category + ' B' }).click();
        await page.getByRole('button', { name: 'Delete category' }).click();
        await page.getByRole('button', { name: 'Close' }).click();
        await page.getByRole('button', { name: category + ' B', exact: true }).waitFor({ state: 'detached' });
        await settleList(page);
        if ((await rows(page).count()) < 1) throw new Error('the list is empty after deleting the selected category');
    });

    await check('icon colour: choose, apply, reset', async () => {
        await rows(page).first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: /Change icon colour/ }).click();
        // A colour the row does not have yet, so Apply has something to save.
        await page.getByRole('button', { name: 'Orange' }).click();
        await page.getByRole('button', { name: 'Apply' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await rows(page).first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: /Change icon colour/ }).click();
        await page.getByRole('button', { name: 'Default' }).click();
        await page.getByRole('button', { name: 'Apply' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
    });

    const order = () =>
        page.locator('.gb-server-item').evaluateAll((items) => items.map((item) => item.dataset.instance));
    await check('reorder: a mouse drag moves the row, it survives a reload, the keyboard puts it back', async () => {
        const before = await order();
        if (before.length < 2) return;
        const grip = page.locator('.gb-server-item').first().locator('.gb-grip button');
        const box = await grip.boundingBox();
        const row = await page.locator('.gb-server-item').first().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let step = 1; step <= 8; step++) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + (row.height * 1.3 * step) / 8);
            await page.waitForTimeout(20);
        }
        await page.mouse.up();
        await page.waitForTimeout(500);
        const dragged = await order();
        if (dragged[0] !== before[1] || dragged[1] !== before[0]) throw new Error('the row did not move');
        await page.reload();
        await rows(page).first().waitFor();
        const reloaded = await order();
        if (reloaded[0] !== before[1]) throw new Error('the new order was not kept');
        await page.locator('.gb-server-item').nth(1).locator('.gb-grip button').focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(600);
        if (JSON.stringify(await order()) !== JSON.stringify(before))
            throw new Error('the keyboard did not restore the order');
    });

    await check('context menu: Escape closes it and focus returns', async () => {
        const first = rows(page).first();
        await first.focus();
        const target = await first.boundingBox();
        await first.click({ button: 'right' });
        const menu = page.getByRole('menu');
        await menu.waitFor();
        // The menu opens at the pointer (the page content must not become the containing block of fixed elements).
        const opened = await menu.boundingBox();
        const centreX = target.x + target.width / 2;
        const centreY = target.y + target.height / 2;
        if (Math.abs(opened.x - centreX) > 4 || Math.abs(opened.y - centreY) > 4)
            throw new Error(`menu opened at ${opened.x},${opened.y}, pointer at ${centreX},${centreY}`);
        await page.keyboard.press('Escape');
        await page.getByRole('menu').waitFor({ state: 'detached' });
    });
    await page.close();
}

export async function fileFlows({ context, baseUrl, check: plain }) {
    const page = await context.newPage();
    const check = withScreenshot(page, plain);
    await page.goto(baseUrl + '/');
    await rows(page).first().waitFor({ timeout: 30000 });
    const id = (await rows(page).first().getAttribute('href')).split('/')[2];
    const open = async (target) => {
        await target.goto(`${baseUrl}/server/${id}/files`);
        await target.waitForSelector('.gb-tree-name', { timeout: 30000 });
    };
    await open(page);

    const run = stamp();
    // Every run searches for a word nobody else wrote, so leftovers of an earlier run cannot change the counts.
    const term = `needle${run}`;
    const note = `flow-${run}.txt`;
    const config = `flow-${run}.json`;
    const folder = `dir-${run}`;
    const root = page.locator('.gb-tree-row.root').first().locator('button').first();

    await check('files: inline create opens the file in Monaco without a minimap', async () => {
        await page.getByRole('button', { name: 'New file' }).first().click();
        await page.getByLabel('File name').fill(note);
        await page.getByLabel('File name').press('Enter');
        await page.locator('.gb-tree-name', { hasText: note }).waitFor();
        await page.locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
        if (
            await page
                .locator('.minimap.slider-mouseover, .minimap canvas')
                .first()
                .isVisible()
                .catch(() => false)
        ) {
            throw new Error('the minimap is visible');
        }
    });
    await check('files: typing and Ctrl+S save and clear the dirty mark', async () => {
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.type(`hello ${term} world\nsecond ${term}`);
        await page.locator('.gb-tab .gb-tree-dirty').waitFor();
        await page.keyboard.press('Control+s');
        await page.getByText(`Saved ${note}`).first().waitFor({ timeout: 10000 });
        await page.locator('.gb-tab .gb-tree-dirty').waitFor({ state: 'detached' });
    });
    await check('files: a name that exists is refused inline', async () => {
        await root.click();
        await page.getByRole('button', { name: 'New file' }).first().click();
        await page.getByLabel('File name').fill(note);
        await page.getByRole('alert').filter({ hasText: 'already exists' }).waitFor();
        await page.getByLabel('File name').press('Escape');
        await page.getByLabel('File name').waitFor({ state: 'detached' });
    });
    await check('files: broken JSON is flagged and save asks first', async () => {
        await page.getByRole('button', { name: 'New file' }).first().click();
        await page.getByLabel('File name').fill(config);
        await page.getByLabel('File name').press('Enter');
        await page.locator('.gb-tab-name', { hasText: config }).waitFor();
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.type('{"a": ');
        await page.getByRole('button', { name: /^1 problem$/ }).waitFor({ timeout: 10000 });
        await page.keyboard.press('Control+s');
        await page.getByRole('dialog').getByText('has a syntax problem').waitFor();
        await page.getByRole('button', { name: 'Keep editing' }).click();
        await page.getByRole('button', { name: /^1 problem$/ }).click();
        await page.getByRole('list', { name: 'Problems' }).waitFor();
    });
    await check('files: folder create, drag move keeps the tab and its text', async () => {
        await root.click();
        await page.getByRole('button', { name: 'New folder' }).first().click();
        await page.getByLabel('Folder name').fill(folder);
        await page.getByLabel('Folder name').press('Enter');
        await page.locator('.gb-tree-name', { hasText: folder }).waitFor();
        const file = page.locator('.gb-tree-row', { hasText: config }).first().locator('button').first();
        await file.dragTo(page.locator('.gb-tree-row', { hasText: folder }).first());
        await page.locator('.gb-tab', { hasText: config }).first().waitFor();
        const title = await page.locator('.gb-tab', { hasText: config }).first().getAttribute('title');
        if (!title?.includes(folder)) throw new Error(`tab path did not follow the move: ${title}`);
        // The unsaved, broken text is still in the tab.
        await page.getByRole('button', { name: /^1 problem$/ }).waitFor();
    });
    await check('files: a folder cannot be dropped into itself', async () => {
        const row = page.locator('.gb-tree-row', { hasText: folder }).first();
        await row.locator('button').first().dragTo(row);
        await page.locator('.gb-tree-name', { hasText: folder }).first().waitFor();
    });
    await check('files: workspace search lists matches and replace shows a preview first', async () => {
        await page.getByRole('button', { name: 'Search all files' }).click();
        await page.getByLabel('Search query').fill(term);
        await page.getByLabel('Search query').press('Enter');
        await page.getByText('2 matches in 1 file').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Show replace' }).click();
        await page.getByLabel('Replace with').fill('thread');
        await page.locator('.gb-search-hit ins').first().waitFor();
        await page.getByRole('button', { name: 'Replace all', exact: true }).click();
        await page.getByRole('dialog').getByText('Replace 2 matches in 1 file?').waitFor();
        await page.getByRole('button', { name: 'Replace', exact: true }).click();
        await page.getByText('Replaced 2 matches.').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Back to files' }).click();
    });
    // A failed search step must not leave the explorer hidden for the steps after it.
    await page
        .getByRole('button', { name: 'Back to files' })
        .click({ timeout: 2000 })
        .catch(() => undefined);
    await check('files: rename inline keeps the open tab', async () => {
        const row = page.locator('.gb-tree-row', { hasText: note }).first();
        await row.locator('button.gb-tree-more').click({ force: true });
        await page.getByRole('menuitem', { name: 'Rename' }).click();
        await page.getByLabel('New name').fill('renamed-' + note);
        await page.getByLabel('New name').press('Enter');
        await page.locator('.gb-tab-name', { hasText: 'renamed-' + note }).waitFor();
    });
    await check('files: an outside change offers Compare, Reload, Overwrite and Cancel', async () => {
        const other = await context.newPage();
        await open(other);
        await other.locator('.gb-tree-name', { hasText: 'renamed-' + note }).click();
        await other.locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
        await other.locator('.monaco-editor').first().click();
        await other.keyboard.press('Control+End');
        await other.keyboard.type(' changed elsewhere');
        // File times have a resolution of one second.
        await other.waitForTimeout(2100);
        await other.keyboard.press('Control+s');
        await other.getByText(`Saved renamed-${note}`).first().waitFor({ timeout: 10000 });
        await other.close();
        await page.bringToFront();
        await page.locator('.gb-tab-name', { hasText: 'renamed-' + note }).click();
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type('!');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByRole('dialog').getByText('changed on the server').waitFor({ timeout: 15000 });
        await page.getByRole('button', { name: 'Compare' }).click();
        await page.getByTestId('diff-view').waitFor();
        await page.getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
    });
    await check('files: the core editor address forwards to the workspace', async () => {
        // A fresh page: this one may still hold an unsaved tab that would raise the leave page warning.
        const fresh = await context.newPage();
        await fresh.goto(`${baseUrl}/server/${id}/files/edit#/renamed-${note}`);
        await fresh.waitForURL(new RegExp(`/server/${id}/files$`), { timeout: 20000 });
        await fresh.close();
    });
    await check('files: nested folders keep open tabs, unsaved text and the explorer in step', async () => {
        const row = (name) => page.locator('.gb-tree-row', { hasText: name }).first();
        const menu = async (name, item) => {
            await row(name).locator('button.gb-tree-more').click({ force: true });
            await page.getByRole('menuitem', { name: item }).click();
        };
        // Only the two files of this check; earlier checks leave other tabs open.
        const tabPaths = () =>
            page
                .locator('.gb-tab')
                .evaluateAll((tabs) =>
                    tabs.map((tab) => tab.getAttribute('title')).filter((path) => /\/[ab]\.txt$/.test(path))
                );
        const first = `tree-${run}`;
        const second = `moved-${run}`;
        const outer = `outer-${run}`;

        // A folder with two files open; one of them has unsaved text.
        await root.click();
        await page.getByRole('button', { name: 'New folder' }).first().click();
        await page.getByLabel('Folder name').fill(first);
        await page.getByLabel('Folder name').press('Enter');
        await row(first).waitFor();
        for (const name of ['a.txt', 'b.txt']) {
            await row(first).locator('button').first().click();
            await page.getByRole('button', { name: 'New file' }).first().click();
            await page.getByLabel('File name').fill(name);
            await page.getByLabel('File name').press('Enter');
            await page.locator('.gb-tab-name', { hasText: name }).waitFor();
        }
        await page.locator('.gb-tab-name', { hasText: 'a.txt' }).click();
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.type('unsaved text');
        await page.locator('.gb-tab', { hasText: 'a.txt' }).locator('.gb-tree-dirty').waitFor();

        // Renaming the folder moves both tabs and keeps the text.
        await menu(first, 'Rename');
        await page.getByLabel('New name').fill(second);
        await page.getByLabel('New name').press('Enter');
        await row(second).waitFor();
        const renamed = await tabPaths();
        if (!renamed.every((path) => path?.includes(second)) || renamed.length < 2)
            throw new Error(`tabs did not follow the rename: ${renamed}`);
        if ((await page.locator('.gb-tab', { hasText: 'a.txt' }).locator('.gb-tree-dirty').count()) !== 1)
            throw new Error('the unsaved mark was lost');

        // Moving it into another folder does the same; the folder cannot go into its own child.
        await root.click();
        await page.getByRole('button', { name: 'New folder' }).first().click();
        await page.getByLabel('Folder name').fill(outer);
        await page.getByLabel('Folder name').press('Enter');
        await row(outer).waitFor();
        await row(second).locator('button').first().dragTo(row(outer));
        await page.waitForFunction(
            (outerName) =>
                [...document.querySelectorAll('.gb-tab')]
                    .filter((tab) => tab.getAttribute('title').includes('moved-'))
                    .every((tab) => tab.getAttribute('title').includes(outerName)),
            outer
        );
        await row(outer).locator('button').first().dragTo(row(second));
        await page.waitForTimeout(400);
        if (!(await tabPaths()).every((path) => path?.includes(`/${outer}/${second}/`)))
            throw new Error('the outer folder moved into its own child');

        // A refusal from the node puts the explorer and the tabs back.
        await page.route('**/files/rename', (request) =>
            request.fulfill({ status: 500, contentType: 'application/json', body: '{"errors":[{"detail":"refused"}]}' })
        );
        await menu(outer, 'Rename');
        await page.getByLabel('New name').fill(`refused-${run}`);
        await page.getByLabel('New name').press('Enter');
        await page.waitForTimeout(800);
        await page.unroute('**/files/rename');
        await row(outer).waitFor();
        if ((await page.locator('.gb-tree-name', { hasText: `refused-${run}` }).count()) !== 0)
            throw new Error('the refused rename stayed in the explorer');
        if (!(await tabPaths()).every((path) => path?.includes(`/${outer}/`)))
            throw new Error('the tabs kept the refused name');

        // Deleting the folder closes the clean tab and keeps the one with unsaved text.
        await menu(outer, 'Delete');
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.locator('.gb-tree-name', { hasText: outer }).waitFor({ state: 'detached' });
        // The tabs follow once the node has confirmed the deletion.
        await page.waitForTimeout(1500);
        if ((await tabPaths()).length !== 1)
            throw new Error(`expected only the tab with unsaved text to stay: ${await tabPaths()}`);
        await page.locator('.gb-tab', { hasText: 'a.txt' }).locator('.gb-tab-close').click();
        await page.getByRole('button', { name: 'Discard changes' }).click();
    });
    await check('files: moving to another server replaces the open tabs', async () => {
        if ((await page.locator('.gb-tab').count()) === 0) throw new Error('this check needs an open tab');
        await page.getByRole('link', { name: 'All instances' }).click();
        const rowsNow = page.locator('a.gb-server-row');
        await rowsNow.first().waitFor();
        if ((await rowsNow.count()) < 2) return;
        const currentHref = `/server/${id}`;
        const href = await rowsNow.evaluateAll(
            (links, current) => links.map((link) => link.getAttribute('href')).find((value) => value !== current),
            currentHref
        );
        await page.locator(`a.gb-server-row[href="${href}"]`).click();
        await page.getByRole('link', { name: 'Files' }).click();
        await page.waitForSelector('.gb-tree-name');
        if ((await page.locator('.gb-tab').count()) !== 0)
            throw new Error('tabs of the previous server are still open');
        // Back to the first server for the checks that follow; its tabs come back from the session.
        await page.getByRole('link', { name: 'All instances' }).click();
        await page.locator(`a.gb-server-row[href="${currentHref}"]`).click();
        await page.getByRole('link', { name: 'Files' }).click();
        await page.waitForSelector('.gb-tree-name');
        await page.locator('.gb-tab').first().waitFor();
    });
    await check('files: delete the folder and files closes their tabs', async () => {
        for (const name of [folder, 'renamed-' + note]) {
            const row = page.locator('.gb-tree-row', { hasText: name }).first();
            await row.locator('button.gb-tree-more').click({ force: true });
            await page.getByRole('menuitem', { name: 'Delete' }).click();
            await page.getByRole('button', { name: 'Delete', exact: true }).click();
            await page.locator('.gb-tree-name', { hasText: name }).waitFor({ state: 'detached' });
        }
    });
    await page.close();
}

/** Touch behaviour of the instance list: a swipe scrolls, a hold lifts, a held drag reorders, a long hold opens actions. */
export async function mobileFlows({ browser, login, scheme, baseUrl, check: plain }) {
    const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: scheme,
        hasTouch: true,
        isMobile: true,
    });
    await login(phone);
    const page = await phone.newPage();
    const check = withScreenshot(page, plain);
    await page.goto(baseUrl + '/');
    await rows(page).first().waitFor({ timeout: 30000 });
    const client = await phone.newCDPSession(page);
    const touch = (type, x, y) =>
        client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const names = () =>
        page.locator('.gb-server-item').evaluateAll((items) => items.map((item) => item.dataset.instance));
    const centre = async (index) => {
        const box = await page.locator('.gb-server-item').nth(index).boundingBox();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, height: box.height };
    };

    await check('touch: a quick swipe does not lift or reorder a row', async () => {
        const before = await names();
        const { x, y } = await centre(0);
        await touch('touchStart', x, y);
        await page.waitForTimeout(60);
        await touch('touchMove', x, y + 40);
        await page.waitForTimeout(60);
        await touch('touchEnd');
        await page.waitForTimeout(200);
        if ((await page.locator('.gb-server-item.lifted, .gb-server-item.dragging').count()) !== 0)
            throw new Error('a row lifted');
        if (JSON.stringify(await names()) !== JSON.stringify(before)) throw new Error('the order changed');
    });

    await check('touch: holding arms then lifts, and dragging down reorders', async () => {
        const before = await names();
        if (before.length < 2) return;
        const first = await centre(0);
        await touch('touchStart', first.x, first.y);
        await page.locator('.gb-server-item.arming').first().waitFor({ timeout: 2000 });
        await page.locator('.gb-server-item.lifted').first().waitFor({ timeout: 3000 });
        for (let step = 1; step <= 6; step++) {
            await touch('touchMove', first.x, first.y + (first.height * 1.2 * step) / 6);
            await page.waitForTimeout(30);
        }
        await touch('touchEnd');
        await page.waitForTimeout(700);
        const after = await names();
        if (after[0] !== before[1] || after[1] !== before[0]) throw new Error(`not reordered: ${after.join(', ')}`);
        // Put the order back for the next run.
        const moved = await centre(0);
        await touch('touchStart', moved.x, moved.y);
        await page.locator('.gb-server-item.lifted').first().waitFor({ timeout: 3000 });
        for (let step = 1; step <= 6; step++) {
            await touch('touchMove', moved.x, moved.y + (moved.height * 1.2 * step) / 6);
            await page.waitForTimeout(30);
        }
        await touch('touchEnd');
        await page.waitForTimeout(700);
        if (JSON.stringify(await names()) !== JSON.stringify(before)) throw new Error('could not restore the order');
    });

    await check('touch: holding without moving opens the actions', async () => {
        const { x, y } = await centre(0);
        await touch('touchStart', x, y);
        await page.getByRole('menu').waitFor({ timeout: 5000 });
        await touch('touchEnd');
        await page.getByRole('menuitem', { name: /Change icon colour/ }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('menu').waitFor({ state: 'detached' });
    });
    await phone.close();
}

/** The editor chunk is requested by the file workspace and by nothing else. */
export async function bundleFlows({ context, baseUrl, check }) {
    const page = await context.newPage();
    const hits = [];
    page.on('request', (request) => {
        if (/monaco|editor\.worker|CodeEditor|codicon/i.test(request.url())) hits.push(request.url().split('/').pop());
    });
    await page.goto(baseUrl + '/');
    await page.locator('a.gb-server-row').first().waitFor({ timeout: 30000 });
    const id = (await page.locator('a.gb-server-row').first().getAttribute('href')).split('/')[2];
    for (const [label, path] of [
        ['dashboard', '/'],
        ['admin overview', '/panel'],
        ['admin nodes', '/panel/nodes'],
        ['templates', '/panel/templates'],
        ['account', '/account'],
        ['server console', `/server/${id}`],
        ['server settings', `/server/${id}/settings`],
    ]) {
        await check(`bundle: ${label} requests no editor code`, async () => {
            await page.goto(baseUrl + path);
            await page.waitForSelector('.gb-app', { timeout: 30000 });
            await page.waitForLoadState('networkidle').catch(() => undefined);
            await page.waitForTimeout(1200);
            if (hits.length > 0) throw new Error(`requested ${hits.join(', ')}`);
        });
    }
    await check('bundle: the file workspace fetches the editor once the explorer is up', async () => {
        await page.goto(`${baseUrl}/server/${id}/files`);
        await page.waitForSelector('.gb-tree-name', { timeout: 30000 });
        await page.waitForFunction(() => window.__gobiaFiles?.['monaco-chunk-loaded'], null, { timeout: 15000 });
        if (hits.length === 0) throw new Error('no editor request was made');
    });
    await page.close();
}

/** Keyboard, focus and reduced motion: dialogs trap and return focus, the tree and the editor work without a mouse. */
export async function keyboardFlows({ context, baseUrl, check: plain }) {
    const page = await context.newPage();
    const check = withScreenshot(page, plain);
    await page.goto(baseUrl + '/');
    await rows(page).first().waitFor({ timeout: 30000 });
    const id = (await rows(page).first().getAttribute('href')).split('/')[2];

    await check('keyboard: a dialog traps Tab, closes on Escape and gives focus back', async () => {
        const trigger = page.getByRole('button', { name: /create instance/i });
        await trigger.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('dialog').waitFor();
        for (let step = 0; step < 14; step++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => document.activeElement?.closest('[role=dialog]') !== null);
            if (!inside) throw new Error(`focus left the dialog after ${step + 1} Tab presses`);
        }
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        const back = await page.evaluate(() => document.activeElement?.textContent?.includes('Create Instance'));
        if (!back) throw new Error('focus did not return to the button that opened the dialog');
    });

    await check('keyboard: menus follow the arrow keys and return focus on Escape', async () => {
        const more = page.getByRole('button', { name: /^Actions for /i }).first();
        await more.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menu').waitFor();
        // Focus moves to the first item as soon as the browser accepts it.
        await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
        await page.keyboard.press('ArrowDown');
        const second = await page.evaluate(() => document.activeElement?.textContent?.trim());
        if (!second?.includes('Change icon colour')) throw new Error(`ArrowDown reached "${second}"`);
        await page.keyboard.press('Escape');
        await page.getByRole('menu').waitFor({ state: 'detached' });
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
        if (!focused.startsWith('Actions for')) throw new Error(`focus is on "${focused}" after Escape`);
    });

    const name = `kbd-${stamp()}.txt`;
    await page.goto(`${baseUrl}/server/${id}/files`);
    await page.waitForSelector('.gb-tree-name', { timeout: 30000 });
    await check('keyboard: the file tree renames with F2, deletes with Delete and Escape backs out', async () => {
        await page.getByRole('button', { name: 'New file' }).first().click();
        await page.getByLabel('File name').fill(name);
        await page.getByLabel('File name').press('Enter');
        await page.locator('.gb-tree-name', { hasText: name }).waitFor();
        const row = page.locator('.gb-tree-row', { hasText: name }).first().locator('button').first();
        await row.focus();
        await page.keyboard.press('F2');
        await page.getByLabel('New name').waitFor();
        await page.keyboard.press('Escape');
        await page.getByLabel('New name').waitFor({ state: 'detached' });
        const kept = await page.evaluate((n) => document.activeElement?.textContent?.includes(n), name);
        if (!kept) throw new Error('focus was lost when the rename was cancelled');
        await row.focus();
        await page.keyboard.press('Delete');
        await page.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.locator('.gb-tree-name', { hasText: name }).waitFor();
    });

    await check('keyboard: the editor takes Find and Replace shortcuts', async () => {
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+f');
        await page.locator('.monaco-editor .find-widget.visible').waitFor();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+h');
        await page.locator('.monaco-editor .find-widget.visible.replaceToggled').waitFor();
        await page.keyboard.press('Escape');
    });

    await check('keyboard: reduced motion switches menu and page animations off', async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(baseUrl + '/');
        await rows(page).first().click({ button: 'right' });
        const animation = await page.getByRole('menu').evaluate((menu) => getComputedStyle(menu).animationName);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        if (animation !== 'none') throw new Error(`menu animation is "${animation}"`);
    });

    // Clean up the file made above.
    await page.goto(`${baseUrl}/server/${id}/files`);
    await page.waitForSelector('.gb-tree-name', { timeout: 30000 });
    const left = page.locator('.gb-tree-row', { hasText: name }).first();
    if (await left.count()) {
        await left.locator('button.gb-tree-more').click({ force: true });
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
    }
    await page.close();
}
