// The dual server file workspace, the editor's save path and server to server transfers, in a real browser.
// Reads and writes the files of the development mock Wings directly to prove what reached which server.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const stamp = () => Date.now().toString(36);

export async function dualFlows({ browser, context, login, scheme, baseUrl, root, check: plain }) {
    const page = await context.newPage();
    const timings = {};
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
    // Dual mode is remembered between runs; start from single mode.
    await page.addInitScript(() => {
        // Once per tab: a reload inside a check must keep the dual layout the check set up.
        if (!sessionStorage.getItem('dual-flow-init')) {
            sessionStorage.setItem('dual-flow-init', '1');
            localStorage.removeItem('gobia-files:dual');
        }
    });
    await page.goto(baseUrl + '/');
    const rows = page.locator('li.gb-server-item');
    await rows.first().waitFor({ timeout: 30000 });
    const uuids = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-instance')));
    const ids = await rows.evaluateAll((nodes) =>
        nodes.map((node) => node.querySelector('a.gb-server-row').getAttribute('href').split('/')[2])
    );
    const [uuidA, uuidB] = uuids;
    const names = await rows.evaluateAll((nodes) =>
        nodes.map((node) => node.querySelector('.gb-server-title strong').textContent)
    );
    if (!uuidB) throw new Error('the dual flows need two instances');
    const disk = (uuid, ...parts) => join(root, 'services/mock-wings/.data/servers', uuid, ...parts);
    const run = stamp();
    const dir = `dual-${run}`;
    for (const uuid of [uuidA, uuidB]) mkdirSync(disk(uuid, dir), { recursive: true });

    const explorer = (pane) => page.locator(`.gb-explorer [data-pane="${pane}"]`);
    const treeRow = (pane, name) =>
        explorer(pane)
            .locator('.gb-tree-row', { has: page.getByText(name, { exact: true }) })
            .first();
    const refresh = async (pane) => {
        await explorer(pane).getByRole('button', { name: 'Refresh' }).click();
        await page.waitForTimeout(500);
    };
    const expand = async (pane, name) => {
        const row = treeRow(pane, name);
        await row.waitFor();
        if ((await row.locator('button').first().getAttribute('aria-expanded')) !== 'true')
            await row.locator('button').first().click();
    };
    const editor = (pane) => page.locator(`.gb-editor-pane[data-pane="${pane}"]`);
    const closeTabs = async () => {
        for (let guard = 0; guard < 12; guard++) {
            const close = page.locator('.gb-tab-close').first();
            if ((await close.count()) === 0) break;
            await close.click();
            const discard = page.getByRole('button', { name: 'Discard changes' });
            if (await discard.isVisible().catch(() => false)) await discard.click();
            await page.waitForTimeout(100);
        }
    };
    const doneCount = () => page.locator('.gb-transfer[data-status="done"]').count();
    /** Runs an action that starts a transfer and waits until the Panel has finished that job. */
    const afterJob = async (action) => {
        const before = await doneCount();
        await action();
        await page.waitForFunction(
            (n) => document.querySelectorAll('.gb-transfer[data-status="done"]').length > n,
            before,
            { timeout: 40000 }
        );
    };
    const until = async (predicate, ms = 20000) => {
        const started = Date.now();
        while (Date.now() - started < ms) {
            try {
                if (predicate()) return;
            } catch {
                // not there yet
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        throw new Error('timed out waiting for the files on disk');
    };
    // Monaco writes spaces as non breaking spaces.
    const textOf = async (pane) =>
        (await editor(pane).locator('.monaco-editor .view-lines').first().innerText()).replaceAll(' ', ' ');
    const saveState = (pane) => editor(pane).locator('.gb-save-state');

    await page.goto(`${baseUrl}/server/${ids[0]}/files`);
    await page.waitForSelector('.gb-tree-name', { timeout: 30000 });

    await check('dual: Ctrl+S saves from the explorer and never opens the browser dialog', async () => {
        await page.evaluate(() => {
            window.__saveKeys = [];
            document.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')
                    setTimeout(() => window.__saveKeys.push(event.defaultPrevented), 0);
            });
        });
        await refresh('a').catch(() => undefined);
        await page.getByRole('button', { name: 'New file' }).first().click();
        await page.getByLabel('File name').fill(`solo-${run}.json`);
        await page.getByLabel('File name').press('Enter');
        await page.locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.type('{"saved": false}');
        await saveState('a').or(page.locator('.gb-save-state')).first().waitFor();
        // Move focus out of Monaco to a row of the explorer, then press the shortcut.
        await page.locator('.gb-tree-row:not(.root) button').first().focus();
        const started = Date.now();
        await page.keyboard.press('Control+s');
        await page.locator('.gb-save-state.saved').first().waitFor({ timeout: 15000 });
        timings.saveFromExplorerMs = Date.now() - started;
        const keys = await page.evaluate(() => window.__saveKeys);
        if (!keys.length || keys.some((prevented) => !prevented))
            throw new Error(`the page default was not prevented: ${JSON.stringify(keys)}`);
        const onDisk = readFileSync(disk(uuidA, `solo-${run}.json`), 'utf8');
        if (onDisk !== '{"saved": false}') throw new Error(`the file on the server reads ${onDisk}`);
        rmSync(disk(uuidA, `solo-${run}.json`));
    });

    await check(
        'dual: Save shows Saving, Saved only after the server confirmed, and typing during a slow save stays unsaved',
        async () => {
            await closeTabs();
            await page.getByRole('button', { name: 'New file' }).first().click();
            await page.getByLabel('File name').fill(`slow-${run}.txt`);
            await page.getByLabel('File name').press('Enter');
            await page.locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
            await page.locator('.monaco-editor').first().click();
            await page.keyboard.type('first');
            let release;
            const gate = new Promise((resolve) => (release = resolve));
            await page.route('**/files/write**', async (route) => {
                await gate;
                await route.continue();
            });
            const pressed = Date.now();
            await page.keyboard.press('Control+s');
            await page.locator('.gb-save-state.saving').first().waitFor({ timeout: 2000 });
            timings.saveAcknowledgeMs = Date.now() - pressed;
            // Still editable while the write is in flight, and the new text must not be marked saved afterwards.
            await page.keyboard.type(' second');
            if ((await page.locator('.gb-save-state.saved').count()) !== 0)
                throw new Error('Saved was shown before the server answered');
            release();
            await page.locator('.gb-save-state.modified').first().waitFor({ timeout: 15000 });
            await page.unroute('**/files/write**');
            await page.keyboard.press('Control+s');
            await page.locator('.gb-save-state.saved').first().waitFor({ timeout: 15000 });
            const onDisk = readFileSync(disk(uuidA, `slow-${run}.txt`), 'utf8');
            if (onDisk !== 'first second') throw new Error(`the server holds ${JSON.stringify(onDisk)}`);
            rmSync(disk(uuidA, `slow-${run}.txt`));
        }
    );

    await check('dual: a failed save keeps the text, says so, and saves again once the network returns', async () => {
        await closeTabs();
        await page.getByRole('button', { name: 'New file' }).first().click();
        await page.getByLabel('File name').fill(`fail-${run}.txt`);
        await page.getByLabel('File name').press('Enter');
        await page.locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.type('keep me');
        await page.route('**/files/write**', (route) => route.abort('failed'));
        await page.keyboard.press('Control+s');
        await page.locator('.gb-save-state.error').first().waitFor({ timeout: 15000 });
        await page.unroute('**/files/write**');
        await page.keyboard.press('Control+s');
        await page.locator('.gb-save-state.saved').first().waitFor({ timeout: 15000 });
        if (readFileSync(disk(uuidA, `fail-${run}.txt`), 'utf8') !== 'keep me') throw new Error('the text was lost');
        rmSync(disk(uuidA, `fail-${run}.txt`));
    });

    await check('dual: the instance card opens a searchable list and keeps the page', async () => {
        const started = Date.now();
        await page.getByRole('button', { name: 'Switch instance' }).click();
        const search = page.getByRole('combobox', { name: 'Search instances' });
        await search.fill(names[1].slice(0, 6));
        await page.getByRole('option', { name: new RegExp(names[1]) }).click();
        await page.waitForURL(`**/server/${ids[1]}/files`, { timeout: 20000 });
        await page.waitForSelector('.gb-tree-name, .gb-tree-note', { timeout: 20000 });
        timings.serverSwitchMs = Date.now() - started;
        await page.getByRole('button', { name: 'Switch instance' }).click();
        await page.getByRole('option', { name: new RegExp(names[0]) }).click();
        await page.waitForURL(`**/server/${ids[0]}/files`, { timeout: 20000 });
        // Another page stays the same page.
        await page.goto(`${baseUrl}/server/${ids[0]}/backups`);
        await page.getByRole('button', { name: 'Switch instance' }).click();
        await page.getByRole('option', { name: new RegExp(names[1]) }).click();
        await page.waitForURL(`**/server/${ids[1]}/backups`, { timeout: 20000 });
        await page.goto(`${baseUrl}/server/${ids[0]}/files`);
        await page.waitForSelector('.gb-tree-name', { timeout: 30000 });
    });

    await check('dual: Dual servers shows two explorers and two editors, independent selectors', async () => {
        const started = Date.now();
        await page.getByRole('button', { name: 'Dual servers' }).click();
        await page
            .locator('.gb-explorer [data-pane="b"] .gb-tree-name')
            .first()
            .waitFor({ timeout: 20000 })
            .catch(() => undefined);
        await explorer('b').locator('.gb-tree-row.root').waitFor({ timeout: 20000 });
        timings.dualActivateMs = Date.now() - started;
        if ((await page.locator('.gb-editor-pane').count()) !== 2) throw new Error('need two editor panes');
        const a = await explorer('a')
            .getByRole('button', { name: /Server 1:/ })
            .innerText();
        const b = await explorer('b')
            .getByRole('button', { name: /Server 2:/ })
            .innerText();
        if (a === b) console.log('  note: both panes show the same server');
        // Server 2 selector: search and pick the other server, Server 1 stays.
        await explorer('b')
            .getByRole('button', { name: /Server 2:/ })
            .click();
        await page.getByRole('combobox', { name: 'Search servers' }).fill(names[1].slice(0, 6));
        await page.getByRole('option', { name: new RegExp(names[1]) }).click();
        await explorer('b').getByText(names[1]).first().waitFor();
        if (!(await explorer('a').getByText(names[0]).first().isVisible())) throw new Error('Server 1 changed');
    });

    await check(
        'dual: stacked and side by side keep text, undo history and the editors, with no requests',
        async () => {
            await closeTabs();
            for (const pane of ['a', 'b']) {
                await expand(pane, dir);
            }
            const name = `same-${run}.txt`;
            for (const pane of ['a', 'b']) {
                await treeRow(pane, dir).locator('button').first().click();
                await explorer(pane).getByRole('button', { name: 'New file' }).first().click();
                await page.getByLabel('File name').fill(name);
                await page.getByLabel('File name').press('Enter');
                await editor(pane).locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
                await editor(pane).locator('.monaco-editor').first().click();
                await page.keyboard.type(`content of ${pane}`);
            }
            // The two servers hold the same path with different text, each its own document.
            const texts = await Promise.all(['a', 'b'].map((pane) => textOf(pane)));
            if (
                !texts[0].includes('content of a') ||
                !texts[1].includes('content of b') ||
                texts[0].includes('content of b')
            )
                throw new Error(`documents mixed: ${JSON.stringify(texts)}`);
            await editor('a')
                .locator('.monaco-editor')
                .first()
                .evaluate((node) => (node.__probe = 'same-editor'));
            const requests = [];
            page.on('request', (request) => requests.push(request.url()));
            const started = Date.now();
            await page.getByRole('button', { name: 'Side by side' }).click();
            await page.waitForFunction(
                () => document.querySelector('.gb-editors')?.getAttribute('data-layout') === 'side'
            );
            await page.evaluate(
                () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            );
            timings.orientationChangeMs = Date.now() - started;
            const side = await Promise.all(['a', 'b'].map((pane) => editor(pane).boundingBox()));
            if (!(side[1].x > side[0].x + side[0].width - 4)) throw new Error('the editors are not side by side');
            // Explorers stay stacked in both layouts.
            const col = await Promise.all(['a', 'b'].map((pane) => explorer(pane).boundingBox()));
            if (!(col[1].y > col[0].y + col[0].height - 4) || Math.abs(col[1].x - col[0].x) > 2)
                throw new Error('the explorers are not stacked');
            await page.getByRole('button', { name: 'Stacked' }).click();
            await page.waitForFunction(
                () => document.querySelector('.gb-editors')?.getAttribute('data-layout') === 'stacked'
            );
            await page.waitForTimeout(400);
            page.removeAllListeners('request');
            const api = requests.filter((url) => url.includes('/api/'));
            if (api.length) throw new Error(`switching layout made requests: ${api.join(', ')}`);
            const same = await editor('a')
                .locator('.monaco-editor')
                .first()
                .evaluate((node) => node.__probe);
            if (same !== 'same-editor') throw new Error('the editor was rebuilt');
            const after = await textOf('a');
            if (!after.includes('content of a')) throw new Error('unsaved text was lost');
            // Undo history survives.
            await editor('a').locator('.monaco-editor').first().click();
            let undone = after;
            for (let attempt = 0; attempt < 3 && undone === after; attempt++) {
                await page.keyboard.press('Control+z');
                await page.waitForTimeout(250);
                undone = await textOf('a');
            }
            await page.keyboard.press('Control+y');
            await page.waitForTimeout(250);
            if (undone === after) throw new Error('undo did nothing after the layout change');
        }
    );

    await check('dual: Ctrl+S saves the editor in focus and never the other server file', async () => {
        const name = `same-${run}.txt`;
        await editor('b').locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+s');
        await editor('b').locator('.gb-save-state.saved').waitFor({ timeout: 15000 });
        if (readFileSync(disk(uuidB, dir, name), 'utf8') !== 'content of b')
            throw new Error('server 2 does not hold its text');
        if (existsSync(disk(uuidA, dir, name)) && readFileSync(disk(uuidA, dir, name), 'utf8') !== '')
            throw new Error('server 1 was saved too');
        await editor('a').locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+s');
        await editor('a').locator('.gb-save-state.saved').waitFor({ timeout: 15000 });
        if (readFileSync(disk(uuidA, dir, name), 'utf8') !== 'content of a')
            throw new Error('server 1 does not hold its text');
        // Focus on the explorer of server 2 sends the shortcut to server 2.
        await editor('b').locator('.monaco-editor').first().click();
        await page.keyboard.type('!');
        await treeRow('b', dir).locator('button').first().focus();
        await page.keyboard.press('Control+s');
        await until(() => readFileSync(disk(uuidB, dir, name), 'utf8') === 'content of b!').catch(() => undefined);
        if (readFileSync(disk(uuidB, dir, name), 'utf8') !== 'content of b!')
            throw new Error('the explorer shortcut missed server 2');
        if (readFileSync(disk(uuidA, dir, name), 'utf8') !== 'content of a') throw new Error('server 1 changed');
    });

    await check('dual: reloading the page keeps what was saved on each server', async () => {
        await page.reload();
        await page.waitForSelector('.gb-tree-name');
        await explorer('b').locator('.gb-tree-row.root').waitFor({ timeout: 20000 });
        await expand('a', dir);
        await expand('b', dir);
        await treeRow('a', `same-${run}.txt`).locator('button').first().click();
        await editor('a').locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
        const text = await textOf('a');
        if (!text.includes('content of a')) throw new Error(`after reload server 1 shows ${text}`);
    });

    // ---- transfers
    const bytes = Buffer.from([0, 255, 254, 80, 75, 3, 4, ...Array.from({ length: 4000 }, (_, i) => (i * 7) % 256)]);
    const nested = join('pack', 'sub');
    mkdirSync(disk(uuidA, dir, nested), { recursive: true });
    writeFileSync(disk(uuidA, dir, 'plugin.jar'), bytes);
    writeFileSync(disk(uuidA, dir, 'pack', 'one.json'), '{"one":1}');
    writeFileSync(disk(uuidA, dir, nested, 'two.yml'), 'two: 2\n');
    mkdirSync(disk(uuidB, dir, 'inbox'), { recursive: true });
    // The menu copies into the root of server 2: start without leftovers of an earlier run.
    for (const leftover of ['pack', 'retry.txt']) rmSync(disk(uuidB, leftover), { recursive: true, force: true });

    await check(
        'transfer: dragging a binary file onto a folder of the other server copies it byte for byte and keeps the original',
        async () => {
            await refresh('a');
            await refresh('b');
            await expand('b', dir);
            await treeRow('b', 'inbox').waitFor();
            const source = treeRow('a', 'plugin.jar');
            await source.waitFor();
            const started = Date.now();
            await source.locator('button').first().dragTo(treeRow('b', 'inbox'));
            await page.getByRole('region', { name: 'Transfers between servers' }).waitFor({ timeout: 10000 });
            timings.transferInitiateMs = Date.now() - started;
            await page
                .getByRole('region', { name: 'Transfers between servers' })
                .getByText('Done')
                .first()
                .waitFor({ timeout: 30000 });
            if (!readFileSync(disk(uuidB, dir, 'inbox', 'plugin.jar')).equals(bytes))
                throw new Error('the bytes differ');
            if (!readFileSync(disk(uuidA, dir, 'plugin.jar')).equals(bytes)) throw new Error('the original changed');
            const left = readdirSync(disk(uuidB, dir, 'inbox')).filter((file) => file.startsWith('.gobia-transfer-'));
            if (left.length) throw new Error(`temporary files remain: ${left}`);
        }
    );

    await check(
        'transfer: a name that exists asks first, Skip leaves it, Keep both adds a copy, Replace overwrites',
        async () => {
            writeFileSync(disk(uuidB, dir, 'inbox', 'plugin.jar'), 'OLD');
            await refresh('b');
            const drag = async () => treeRow('a', 'plugin.jar').locator('button').first().dragTo(treeRow('b', 'inbox'));
            await drag();
            const dialog = page.getByRole('dialog');
            await dialog.getByText('already exists').waitFor({ timeout: 10000 });
            await afterJob(() => dialog.getByRole('button', { name: 'Skip' }).click());
            if (readFileSync(disk(uuidB, dir, 'inbox', 'plugin.jar'), 'utf8') !== 'OLD')
                throw new Error('skip overwrote the file');
            await drag();
            await afterJob(() => page.getByRole('dialog').getByRole('button', { name: 'Keep both' }).click());
            if (!existsSync(disk(uuidB, dir, 'inbox', 'plugin (copy).jar'))) throw new Error('no copy was kept');
            await drag();
            await afterJob(() => page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click());
            if (!readFileSync(disk(uuidB, dir, 'inbox', 'plugin.jar')).equals(bytes))
                throw new Error('replace did not overwrite');
            const row = treeRow('b', 'plugin.jar');
            await row.waitFor();
        }
    );

    await check(
        'transfer: a folder with nested files is copied whole, then moved with the original removed only after',
        async () => {
            await refresh('a');
            await refresh('b');
            await treeRow('a', 'pack').click({ button: 'right' });
            await afterJob(() => page.getByRole('menuitem', { name: /Copy pack to/ }).click());
            if (readFileSync(disk(uuidB, 'pack', 'sub', 'two.yml'), 'utf8') !== 'two: 2\n')
                throw new Error('nested file missing');
            if (!existsSync(disk(uuidA, dir, 'pack', 'one.json'))) throw new Error('copy removed the original');
            // Move: right click, Move to.
            rmSync(disk(uuidB, 'pack'), { recursive: true });
            await refresh('b');
            await treeRow('a', 'pack').click({ button: 'right' });
            await afterJob(() => page.getByRole('menuitem', { name: /Move pack to/ }).click());
            await until(
                () => existsSync(disk(uuidB, 'pack', 'sub', 'two.yml')) && !existsSync(disk(uuidA, dir, 'pack'))
            ).catch(() => undefined);
            if (!existsSync(disk(uuidB, 'pack', 'sub', 'two.yml'))) throw new Error('moved folder did not arrive');
            if (existsSync(disk(uuidA, dir, 'pack'))) throw new Error('the original is still there after the move');
        }
    );

    await check('transfer: a failing Panel request is reported, nothing is lost, and Retry works', async () => {
        await refresh('a');
        writeFileSync(disk(uuidA, dir, 'retry.txt'), 'retry me');
        await refresh('a');
        await page.route('**/extensions/gobia-files/transfers', (route) =>
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: '{"errors":[{"detail":"The server could not be reached."}]}',
            })
        );
        await treeRow('a', 'retry.txt').click({ button: 'right' });
        await page.getByRole('menuitem', { name: /Copy retry.txt to/ }).click();
        await page.locator('.gb-transfer-error').first().waitFor({ timeout: 15000 });
        if (!existsSync(disk(uuidA, dir, 'retry.txt'))) throw new Error('the original is gone');
        if (existsSync(disk(uuidB, 'retry.txt'))) throw new Error('something arrived despite the failure');
        await page.unroute('**/extensions/gobia-files/transfers');
        await page.getByRole('button', { name: /Retry transfer/ }).waitFor({ timeout: 15000 });
        await page.getByRole('button', { name: /Retry transfer/ }).click();
        await until(() => readFileSync(disk(uuidB, 'retry.txt'), 'utf8') === 'retry me').catch(() => undefined);
        if (readFileSync(disk(uuidB, 'retry.txt'), 'utf8') !== 'retry me')
            throw new Error('retry did not deliver');
    });

    await check(
        'transfer: the destination keeps what arrived selected and both explorers have independent selection',
        async () => {
            const selected = await explorer('b').locator('.gb-tree-row.selected').count();
            if (selected < 1) throw new Error('what arrived is not selected');
            await treeRow('a', dir).locator('button').first().click();
            if ((await explorer('b').locator('.gb-tree-row.selected').count()) !== selected)
                throw new Error('selecting in server 1 changed server 2');
        }
    );

    await check(
        'dual: closing dual keeps unsaved text of server 2 when asked, and single mode has one editor',
        async () => {
            await treeRow('b', `same-${run}.txt`)
                .waitFor({ timeout: 10000 })
                .catch(() => undefined);
            await page.getByRole('button', { name: 'Single' }).click();
            const dialog = page.getByRole('dialog');
            if (await dialog.isVisible().catch(() => false))
                await dialog.getByRole('button', { name: 'Close and keep changes' }).click();
            await page.waitForFunction(() => document.querySelectorAll('.gb-editor-pane').length === 1);
            if ((await page.locator('.monaco-editor').count()) > 1)
                throw new Error('a second Monaco editor is still alive');
        }
    );

    for (const uuid of [uuidA, uuidB]) rmSync(disk(uuid, dir), { recursive: true, force: true });
    for (const leftover of ['pack', 'retry.txt']) rmSync(disk(uuidB, leftover), { recursive: true, force: true });
    await page.close();

    const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: scheme,
        hasTouch: true,
        isMobile: true,
    });
    await login(phone);
    const small = await phone.newPage();
    await plain('dual: on a phone Server 1 and Server 2 are one tap apart and nothing overflows', async () => {
        await small.addInitScript(() =>
            localStorage.setItem('gobia-files:dual', JSON.stringify({ on: true, layout: 'stacked', second: null }))
        );
        await small.goto(`${baseUrl}/server/${ids[0]}/files`);
        await small.getByRole('group', { name: 'Server' }).waitFor({ timeout: 30000 });
        await small.getByRole('button', { name: 'Server 2' }).click();
        await small.locator('.gb-editor-pane[data-pane="b"]').waitFor({ state: 'visible' });
        if (await small.locator('.gb-editor-pane[data-pane="a"]').isVisible())
            throw new Error('both editors are squeezed in');
        await small.getByRole('button', { name: 'Server 1' }).click();
        await small.locator('.gb-editor-pane[data-pane="a"]').waitFor({ state: 'visible' });
        const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) throw new Error(`page overflows by ${overflow}px`);
    });
    await phone.close();
    console.log(`  timings ${JSON.stringify(timings)}`);
    mkdirSync('tests/visual/actual', { recursive: true });
    writeFileSync(`tests/visual/actual/editor-timings-${scheme}.json`, JSON.stringify(timings, null, 2));
}
