// File explorer: persistent and multiple selection, drag and drop that keeps the selection, rename, expand, tabs and
// the language icons. Called by visual.mjs with a logged in browser context.

const rows = (page) => page.locator('a.gb-server-row');
const stamp = () => Date.now().toString(36);

export async function explorerFlows({ browser, context, login, scheme, baseUrl, check: plain }) {
    const page = await context.newPage();
    const check = (label, work) =>
        plain(label, async () => {
            try {
                await work();
            } catch (error) {
                const name = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                await page.screenshot({ path: `tests/visual/actual/flow-${name}.png` }).catch(() => undefined);
                await page.keyboard.press('Escape').catch(() => undefined);
                throw error;
            }
        });
    await page.goto(baseUrl + '/');
    await rows(page).first().waitFor({ timeout: 30000 });
    const id = (await rows(page).first().getAttribute('href')).split('/')[2];
    await page.goto(`${baseUrl}/server/${id}/files`);
    await page.waitForSelector('.gb-tree-name', { timeout: 30000 });

    const run = stamp();
    const [a, b, c] = [`sel-a-${run}.json`, `sel-b-${run}.rs`, `sel-c-${run}.py`];
    const [f1, f2] = [`sel-f1-${run}`, `sel-f2-${run}`];
    const row = (name) => page.locator('.gb-tree-row', { has: page.getByText(name, { exact: true }) }).first();
    const button = (name) => row(name).locator('button').first();
    const isSelected = async (name) => (await row(name).getAttribute('class'))?.includes(' selected') ?? false;
    const away = () => page.mouse.move(900, 700);
    const root = page.locator('.gb-tree-row.root').first().locator('button').first();
    const create = async (what, label, name) => {
        await root.click();
        await page.getByRole('button', { name: what }).first().click();
        await page.getByLabel(label).fill(name);
        await page.getByLabel(label).press('Enter');
        await page.locator('.gb-tree-name', { hasText: name }).first().waitFor();
    };

    await check('explorer: entries are created and a created entry is selected', async () => {
        await create('New folder', 'Folder name', f1);
        await create('New folder', 'Folder name', f2);
        await create('New file', 'File name', a);
        await create('New file', 'File name', b);
        await create('New file', 'File name', c);
        if (!(await isSelected(c))) throw new Error('the new file is not selected');
    });

    await check('explorer: a selected file and a selected folder stay highlighted when the pointer leaves', async () => {
        await button(a).click();
        await away();
        if (!(await isSelected(a))) throw new Error('file lost its highlight');
        await button(f1).click();
        await away();
        if (!(await isSelected(f1))) throw new Error('folder lost its highlight');
        if (await isSelected(a)) throw new Error('two items are selected after a plain click');
        // The whole row is painted, not only the label.
        await page.waitForTimeout(400);
        const background = await row(f1).evaluate((element) => getComputedStyle(element).backgroundColor);
        if (background === 'rgba(0, 0, 0, 0)') throw new Error('selected row has no background');
        await button(f1).click(); // collapse again
    });

    await check('explorer: ctrl and shift click select several rows that all stay highlighted', async () => {
        await button(a).click();
        await button(c).click({ modifiers: ['Control'] });
        await away();
        if (!(await isSelected(a)) || !(await isSelected(c))) throw new Error('ctrl click did not keep both');
        if (await isSelected(b)) throw new Error('b should not be selected');
        await button(a).click();
        await button(c).click({ modifiers: ['Shift'] });
        await away();
        for (const name of [a, b, c]) if (!(await isSelected(name))) throw new Error(`${name} is not in the range`);
    });

    await check('explorer: dragging selected files into a folder keeps them selected at the destination', async () => {
        await button(a).click();
        await button(b).click({ modifiers: ['Control'] });
        await button(b).dragTo(row(f1));
        await page.getByText(a, { exact: true }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);
        // The folder opens at the destination; both moved files are listed and highlighted.
        await row(a).waitFor();
        await row(b).waitFor();
        if (!(await isSelected(a)) || !(await isSelected(b))) throw new Error('moved files lost the selection');
        const leftover = await page.locator('.gb-tree-row.drop-ok, .gb-tree-row.drop-valid, .gb-tree-row.dragged').count();
        if (leftover !== 0) throw new Error(`${leftover} rows keep a drag highlight`);
    });

    await check('explorer: a folder can be dragged and stays selected', async () => {
        await button(f2).click();
        await button(f2).dragTo(row(f1));
        await row(f2).waitFor();
        await page.waitForTimeout(400);
        if (!(await isSelected(f2))) throw new Error('moved folder lost the selection');
    });

    await check('explorer: renaming keeps the item selected', async () => {
        const renamed = `sel-renamed-${run}.py`;
        await button(c).click();
        await page.keyboard.press('F2');
        await page.getByLabel('New name').fill(renamed);
        await page.getByLabel('New name').press('Enter');
        await row(renamed).waitFor();
        if (!(await isSelected(renamed))) throw new Error('renamed file is not selected');
    });

    await check('explorer: collapsing and expanding a folder keeps its selection', async () => {
        await button(f1).click();
        await away();
        if (!(await isSelected(f1))) throw new Error('folder lost selection on collapse');
        await button(f1).click();
        await away();
        if (!(await isSelected(f1))) throw new Error('folder lost selection on expand');
    });

    await check('explorer: switching editor tabs keeps the explorer selection and tabs show language icons', async () => {
        await row(a).waitFor();
        await button(a).click(); // opens the json file
        await page.locator('.gb-tab', { hasText: a }).first().waitFor();
        await button(b).click();
        await page.locator('.gb-tab', { hasText: b }).first().waitFor();
        await button(a).click({ modifiers: ['Control'] });
        await page.locator('.gb-tab-name', { hasText: a }).first().click();
        await away();
        if (!(await isSelected(a))) throw new Error('selection lost after switching tabs');
        const marks = await page.locator('.gb-tab .gb-file-badge').evaluateAll((nodes) => nodes.map((node) => node.dataset.kind));
        if (!marks.includes('{}') || !marks.includes('RS')) throw new Error(`tab icons: ${marks.join(',')}`);
        const tree = await page.locator('.gb-tree .gb-file-badge').evaluateAll((nodes) => nodes.map((node) => node.dataset.kind));
        if (!tree.includes('{}') || !tree.includes('RS') || !tree.includes('PY')) throw new Error(`tree icons: ${tree.join(',')}`);
    });

    await check('explorer: an empty area clears the selection, delete removes the selected set', async () => {
        await page.locator('.gb-tree').evaluate((element) => element.parentElement.click());
        if (await isSelected(a)) throw new Error('selection not cleared');
        await button(f1).click();
        await page.keyboard.press('Delete');
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await row(f1).waitFor({ state: 'detached', timeout: 15000 });
        // Leftover entries of this run at the root.
        for (const name of [`sel-renamed-${run}.py`]) {
            if ((await page.locator('.gb-tree-name', { hasText: name }).count()) > 0) {
                await button(name).click();
                await page.keyboard.press('Delete');
                await page.getByRole('button', { name: 'Delete', exact: true }).click();
            }
        }
    });
    await page.close();

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true, isMobile: true });
    await login(phone);
    const small = await phone.newPage();
    await plain('explorer: on a phone a selected row stays highlighted', async () => {
        await small.goto(`${baseUrl}/server/${id}/files`);
        await small.waitForSelector('.gb-tree-name, .gb-workspace-head', { timeout: 30000 });
        const toggle = small.getByRole('button', { name: /files|explorer/i }).first();
        if (await toggle.isVisible().catch(() => false)) await toggle.click().catch(() => undefined);
        const first = small.locator('.gb-tree-row:not(.root) > button').first();
        if (!(await first.isVisible().catch(() => false))) return;
        await first.click();
        await small.mouse.move(5, 5);
        const cls = await small.locator('.gb-tree-row:not(.root)').first().getAttribute('class');
        if (!cls.includes('selected') && !cls.includes('active-file')) throw new Error('row not highlighted on phone');
    });
    await phone.close();
}
