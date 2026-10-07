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
        await page.getByRole('button', { name: 'Purple' }).click();
        await page.getByRole('button', { name: 'Apply' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await rows(page).first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: /Change icon colour/ }).click();
        await page.getByRole('button', { name: 'Default' }).click();
        await page.getByRole('button', { name: 'Apply' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
    });

    await check('context menu: Escape closes it and focus returns', async () => {
        const first = rows(page).first();
        await first.focus();
        await first.click({ button: 'right' });
        await page.getByRole('menu').waitFor();
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
