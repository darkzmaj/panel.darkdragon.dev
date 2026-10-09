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

    await check(
        'explorer: a selected file and a selected folder stay highlighted when the pointer leaves',
        async () => {
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
        }
    );

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
        await page
            .getByText(a, { exact: true })
            .waitFor({ state: 'detached', timeout: 15000 })
            .catch(() => undefined);
        // The folder opens at the destination; both moved files are listed and highlighted.
        await row(a).waitFor();
        await row(b).waitFor();
        if (!(await isSelected(a)) || !(await isSelected(b))) throw new Error('moved files lost the selection');
        const leftover = await page
            .locator('.gb-tree-row.drop-ok, .gb-tree-row.drop-valid, .gb-tree-row.dragged')
            .count();
        if (leftover !== 0) throw new Error(`${leftover} rows keep a drag highlight`);
    });

    await check('explorer: a folder can be dragged and stays selected', async () => {
        await button(f2).click();
        await button(f2).dragTo(row(f1));
        await row(f2).waitFor();
        await page.waitForTimeout(400);
        if (!(await isSelected(f2))) throw new Error('moved folder lost the selection');
    });

    await check(
        'explorer: a listing that was requested before a move cannot undo it or drop the selection',
        async () => {
            // The race behind the old flake: a refresh started while the server was still renaming returned the old folder
            // contents and replaced the moved row, which then pruned the selection.
            const racer = `sel-race-${run}`;
            await create('New folder', 'Folder name', racer);
            await button(racer).click();
            await page.route('**/files/rename', async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 1800));
                await route.continue();
            });
            await button(racer).dragTo(row(f1));
            for (const wait of [200, 500, 600]) {
                await page.waitForTimeout(wait);
                await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            }
            await page.waitForTimeout(2500);
            await page.unroute('**/files/rename');
            await row(racer).waitFor();
            if (!(await isSelected(racer))) throw new Error('the moved folder lost its selection during the move');
            const parent = await row(racer).evaluate(
                (element) =>
                    element
                        .closest('.gb-tree-group')
                        ?.parentElement?.closest('.gb-tree-group')
                        ?.querySelector('.gb-tree-name')?.textContent
            );
            if (parent !== f1) throw new Error(`the folder is listed under ${parent} instead of ${f1}`);
        }
    );

    await check('explorer: right click anywhere opens the Gobia menu, never the browser one', async () => {
        const wrapper = page.locator('.gb-tree').locator('xpath=..');
        const box = await wrapper.boundingBox();
        for (const point of [
            { x: box.x + box.width / 2, y: box.y + box.height - 6, what: 'the empty space' },
            { x: box.x + 6, y: box.y + box.height - 6, what: 'the empty corner' },
        ]) {
            await page.mouse.click(point.x, point.y, { button: 'right' });
            await page
                .getByRole('menuitem', { name: 'New file' })
                .waitFor({ timeout: 3000 })
                .catch(() => {
                    throw new Error(`no Gobia menu on ${point.what}`);
                });
            await page.keyboard.press('Escape');
        }
        await page
            .locator('.gb-explorer-tools:visible')
            .first()
            .click({ button: 'right', position: { x: 262, y: 10 }, force: true });
        await page.getByRole('menuitem', { name: 'New folder' }).waitFor({ timeout: 3000 });
        await page.keyboard.press('Escape');
    });

    const mouseDrag = async (source, target, hold = 900) => {
        const from = await source.boundingBox();
        const to = await target.boundingBox();
        await page.mouse.move(from.x + 40, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + 60, from.y + from.height / 2 + 4, { steps: 3 });
        await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 8 });
        await page.waitForTimeout(hold);
        // Browsers repeat dragover while the pointer rests; one small move stands in for that.
        await page.mouse.move(to.x + 43, to.y + to.height / 2);
    };

    await check(
        'explorer: dragging lights only the folder under the pointer and opens nothing until something is dropped in',
        async () => {
            const closed = `sel-closed-${run}`;
            const loose = `sel-loose-${run}.txt`;
            await create('New folder', 'Folder name', closed);
            await create('New file', 'File name', loose);
            await page.keyboard.press('Escape');
            await button(loose).click();
            await mouseDrag(button(loose), row(closed));
            const lit = await page.locator('.gb-tree-row.drop-ok, .gb-tree-row.drop-valid').count();
            const onlyTarget = (await row(closed).getAttribute('class')).includes('drop-ok');
            const expanded = await button(closed).getAttribute('aria-expanded');
            await page.mouse.up();
            if (lit !== 1 || !onlyTarget)
                throw new Error(`${lit} rows are lit while dragging, expected only the folder under the pointer`);
            if (expanded === 'true') throw new Error('the folder opened just because the pointer rested on it');
            // After the drop it opens and shows what arrived.
            await row(loose).waitFor({ timeout: 10000 });
            if ((await button(closed).getAttribute('aria-expanded')) !== 'true')
                throw new Error('the folder did not open after the file was put in');
        }
    );

    await check('explorer: a file can be dropped on the root folder row and on the empty space', async () => {
        const inside = `sel-inside-${run}`;
        const moved = `sel-up-${run}.txt`;
        await create('New folder', 'Folder name', inside);
        await create('New file', 'File name', moved);
        await button(moved).click();
        await button(moved).dragTo(row(inside));
        await row(moved).waitFor();
        const depthOf = async () =>
            Number((await button(moved).getAttribute('style'))?.match(/padding-left: ([0-9]+)px/)?.[1] ?? 0);
        const deep = await depthOf();
        // Onto the root row.
        await button(moved).dragTo(page.locator('.gb-tree-row.root').first());
        await page.waitForFunction(
            (name) =>
                [...document.querySelectorAll('.gb-tree-row button[data-path]')].some(
                    (node) => node.dataset.path === '/' + name
                ),
            moved,
            { timeout: 10000 }
        );
        if ((await depthOf()) >= deep) throw new Error('the file is still inside the folder');
        // Into the folder again, then onto the empty space below the rows.
        await button(moved).dragTo(row(inside));
        await row(moved).waitFor();
        const wrapper = page.locator('.gb-tree').locator('xpath=..');
        const box = await wrapper.boundingBox();
        await mouseDrag(button(moved), row(inside), 100);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction(
            (name) =>
                [...document.querySelectorAll('.gb-tree-row button[data-path]')].some(
                    (node) => node.dataset.path === '/' + name
                ),
            moved,
            { timeout: 10000 }
        );
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

    await check(
        'explorer: switching editor tabs keeps the explorer selection and tabs show language icons',
        async () => {
            await row(a).waitFor();
            await button(a).click(); // opens the json file
            await page.locator('.gb-tab', { hasText: a }).first().waitFor();
            await button(b).click();
            await page.locator('.gb-tab', { hasText: b }).first().waitFor();
            await button(a).click({ modifiers: ['Control'] });
            await page.locator('.gb-tab-name', { hasText: a }).first().click();
            await away();
            if (!(await isSelected(a))) throw new Error('selection lost after switching tabs');
            const read = (selector) =>
                page.locator(selector).evaluateAll((nodes) =>
                    nodes.map((node) => ({
                        icon: node.dataset.icon,
                        shown: node.complete && node.naturalWidth > 0 && node.getBoundingClientRect().width > 0,
                    }))
                );
            const tabs = await read('.gb-tab img.gb-ftype');
            const tree = await read('.gb-tree img.gb-ftype');
            for (const wanted of ['json', 'rust']) {
                if (!tabs.some((icon) => icon.icon === wanted && icon.shown))
                    throw new Error(`tab icon ${wanted} missing or not drawn: ${JSON.stringify(tabs)}`);
            }
            for (const wanted of ['json', 'rust', 'python']) {
                if (!tree.some((icon) => icon.icon === wanted && icon.shown))
                    throw new Error(`tree icon ${wanted} missing or not drawn`);
            }
            if (!tree.some((icon) => icon.icon?.startsWith('folder') && icon.shown))
                throw new Error('folders have no folder icon');
            if (tree.some((icon) => !icon.shown)) throw new Error('an icon failed to render');
        }
    );

    await check(
        'explorer: hierarchy: root items share one indent, each level indents 16 px, folders and files differ',
        async () => {
            const top = page.locator('.gb-tree-children.root > .gb-tree-group > .gb-tree-row');
            const lefts = await top.evaluateAll((nodes) =>
                nodes.map((node) => parseFloat(getComputedStyle(node.querySelector('button')).paddingLeft))
            );
            if (lefts.length < 2 || new Set(lefts).size !== 1)
                throw new Error('root items do not share one indent: ' + lefts);
            const rootLeft = await root.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
            if (lefts[0] <= rootLeft) throw new Error('root items are not indented under the root');
            const weights = await top.evaluateAll((nodes) =>
                nodes.map((node) => [
                    node.classList.contains('dir'),
                    Number(getComputedStyle(node.querySelector('.gb-tree-name')).fontWeight),
                ])
            );
            const dirWeight = weights.find(([dir]) => dir)?.[1];
            const fileWeight = weights.find(([dir]) => !dir)?.[1];
            if (dirWeight === undefined || fileWeight === undefined || dirWeight <= fileWeight)
                throw new Error('folders and files look the same');
            // A file created inside a folder sits one level deeper and hangs off a guide line.
            const folder = (
                await page
                    .locator('.gb-tree-children.root > .gb-tree-group > .gb-tree-row.dir .gb-tree-name')
                    .first()
                    .innerText()
            ).trim();
            await button(folder).click();
            await page.getByRole('button', { name: 'New file' }).first().click();
            const nested = 'nest-' + run + '.txt';
            await page.getByLabel('File name').fill(nested);
            await page.getByLabel('File name').press('Enter');
            await page.locator('.gb-tree-name', { hasText: nested }).first().waitFor();
            const childLeft = await button(nested).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
            if (childLeft !== lefts[0] + 16)
                throw new Error('a child is not 16 px deeper than its folder: ' + childLeft);
            if ((await row(folder).locator('xpath=..').locator('.gb-tree-children').count()) < 1)
                throw new Error('the open folder has no guide for its children');
            if ((await page.locator('.gb-tree-children.root').count()) !== 1) throw new Error('the root has no guide');
            // Collapsing and expanding must not move unrelated rows.
            const sibling = await top.last().evaluate((node) => node.getBoundingClientRect().left);
            await button(folder).click();
            await button(folder).click();
            if ((await top.last().evaluate((node) => node.getBoundingClientRect().left)) !== sibling)
                throw new Error('an unrelated row moved');
            if (!(await isSelected(folder))) throw new Error('expanding changed the selection');
        }
    );

    await check('explorer: an empty area clears the selection, delete removes the selected set', async () => {
        await page.locator('.gb-tree').evaluate((element) => element.parentElement.click());
        if (await isSelected(a)) throw new Error('selection not cleared');
        await button(f1).click();
        await page.keyboard.press('Delete');
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await row(f1).waitFor({ state: 'detached', timeout: 15000 });
        // Leftover entries of this run at the root.
        for (const name of [
            `sel-renamed-${run}.py`,
            `sel-closed-${run}`,
            `sel-inside-${run}`,
            `sel-up-${run}.txt`,
            `sel-race-${run}`,
        ]) {
            if ((await page.locator('.gb-tree-name', { hasText: name }).count()) > 0) {
                await button(name).click();
                await page.keyboard.press('Delete');
                await page.getByRole('button', { name: 'Delete', exact: true }).click();
                await page
                    .locator('.gb-tree-name', { hasText: name })
                    .first()
                    .waitFor({ state: 'detached', timeout: 10000 })
                    .catch(() => undefined);
            }
        }
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
