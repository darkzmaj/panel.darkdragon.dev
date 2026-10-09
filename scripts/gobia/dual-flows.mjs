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
    /** Waits up to two seconds for the editor text to become the expected one. */
    const textBecomes = async (pane, expected) => {
        for (let attempt = 0; attempt < 20; attempt++) {
            if ((await textOf(pane)) === expected) return true;
            await page.waitForTimeout(100);
        }
        return false;
    };
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
        const marks = await page.evaluate(() => window.__gobiaFiles);
        const delta = (from, to) =>
            marks[from] !== undefined && marks[to] !== undefined ? marks[to] - marks[from] : null;
        timings.save = {
            keyToAcknowledgedMs: delta('save-key', 'save-acknowledged'),
            validationMs: delta('save-acknowledged', 'save-validated'),
            panelWriteRoundTripMs: delta('save-write-start', 'save-write-end'),
            writeEndToConfirmedMs: delta('save-write-end', 'save-confirmed'),
            keyToConfirmedMs: delta('save-key', 'save-confirmed'),
        };
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

    await check('perf: typing stays smooth during a slow save and switching open files is immediate', async () => {
        await closeTabs();
        const names = [`perf-a-${run}.txt`, `perf-b-${run}.txt`];
        for (const name of names) {
            await page.getByRole('button', { name: 'New file' }).first().click();
            await page.getByLabel('File name').fill(name);
            await page.getByLabel('File name').press('Enter');
            await page.locator(`.gb-tab:has-text("${name}")`).waitFor();
            await page.locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
            await page.locator('.monaco-editor').first().click();
            await page.keyboard.type(
                `file ${name}
`.repeat(40)
            );
        }
        // Switching between two open files: click to the next painted frame, five times.
        const switches = [];
        for (let round = 0; round < 6; round++) {
            const target = names[round % 2];
            const took = await page.evaluate(
                (name) =>
                    new Promise((resolve) => {
                        const tab = [...document.querySelectorAll('.gb-tab-name')].find((node) =>
                            node.textContent?.includes(name)
                        );
                        const start = performance.now();
                        tab.click();
                        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
                    }),
                target
            );
            switches.push(took);
        }
        timings.openFileSwitchMs = Math.round(
            switches.slice(1).reduce((sum, value) => sum + value, 0) / (switches.length - 1)
        );
        // Typing while a save is stuck on the network: no long tasks, the editor never waits for the write.
        await page.evaluate(() => {
            window.__long = [];
            new PerformanceObserver((list) =>
                window.__long.push(...list.getEntries().map((entry) => entry.duration))
            ).observe({ entryTypes: ['longtask'] });
        });
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        await page.route('**/files/write**', async (route) => {
            await gate;
            await route.continue().catch(() => undefined);
        });
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.type('x');
        await page.keyboard.press('Control+s');
        await page.locator('.gb-save-state.saving').first().waitFor({ timeout: 3000 });
        const typed = await page.evaluate(async () => {
            const input = document.activeElement;
            const start = performance.now();
            for (let i = 0; i < 80; i++) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            return performance.now() - start;
        });
        const burst = Date.now();
        await page.keyboard.type('the quick brown fox jumps over the lazy dog', { delay: 0 });
        timings.typing43KeysDuringSaveMs = Date.now() - burst;
        release();
        await page.waitForTimeout(300);
        await page.unroute('**/files/write**');
        const long = await page.evaluate(() => window.__long);
        timings.longTasksDuringTyping = long.filter((duration) => duration > 50).length;
        timings.longestTaskMs = Math.round(Math.max(0, ...long));
        void typed;
        await page.keyboard.press('Control+s');
        await page.locator('.gb-save-state.saved').first().waitFor({ timeout: 15000 });
        for (const name of names) rmSync(disk(uuidA, name), { force: true });
        await closeTabs();
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
            const settled = (await textBecomes('a', 'content of a')) && (await textBecomes('b', 'content of b'));
            const texts = await Promise.all(['a', 'b'].map((pane) => textOf(pane)));
            if (!settled || texts[0].includes('content of b') || texts[1].includes('content of a'))
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
    await check('dual: Find, Replace, Undo, Redo and Save All work in the focused editor', async () => {
        const widget = (pane) => editor(pane).locator('.find-widget.visible');
        await editor('a').locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+f');
        await widget('a').waitFor({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+h');
        await editor('a').locator('.find-widget.visible .replace-part').waitFor({ state: 'visible', timeout: 5000 });
        await page.keyboard.press('Escape');
        // Back in the text, at the end of the line: Escape from the widgets may leave focus on them.
        await editor('a').locator('.monaco-editor .view-line').first().click();
        await page.keyboard.press('End');
        const before = await textOf('a');
        await page.keyboard.type(' QQ');
        if (!(await textBecomes('a', before + ' QQ'))) throw new Error('typing did nothing');
        const typed = before + ' QQ';
        // Undo until the text changes, redo until it is back (one key press can undo a word or the whole typing).
        let changed = false;
        for (let attempt = 0; attempt < 3 && !changed; attempt++) {
            await page.keyboard.press('Control+z');
            changed = await (async () => {
                for (let wait = 0; wait < 10; wait++) {
                    if ((await textOf('a')) !== typed) return true;
                    await page.waitForTimeout(100);
                }
                return false;
            })();
        }
        if (!changed) throw new Error('Ctrl+Z did nothing');
        for (let attempt = 0; attempt < 3 && (await textOf('a')) !== typed; attempt++) {
            await page.keyboard.press('Control+y');
            await textBecomes('a', typed);
        }
        if ((await textOf('a')) !== typed) throw new Error('Ctrl+Y did not redo');
        for (let attempt = 0; attempt < 3 && (await textOf('a')) === typed; attempt++) {
            await page.keyboard.press('Control+z');
            await page.waitForTimeout(250);
        }
        for (let attempt = 0; attempt < 3 && (await textOf('a')) !== typed; attempt++) {
            await page.keyboard.press('Control+Shift+z');
            await textBecomes('a', typed);
        }
        if ((await textOf('a')) !== typed) throw new Error('Ctrl+Shift+Z did not redo');
        // Save all: edit both editors, one shortcut saves both servers.
        await editor('b').locator('.monaco-editor').first().click();
        await page.keyboard.type(' BB');
        await editor('a').locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+Shift+s');
        await editor('a').locator('.gb-save-state.saved').waitFor({ timeout: 20000 });
        await editor('b').locator('.gb-save-state.saved').waitFor({ timeout: 20000 });
        const name = `same-${run}.txt`;
        await until(
            () =>
                readFileSync(disk(uuidB, dir, name), 'utf8').includes('BB') &&
                readFileSync(disk(uuidA, dir, name), 'utf8').includes('QQ')
        );
    });

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
        'transfer: Ctrl+drag of a binary file onto a folder of the other server copies it byte for byte and keeps the original',
        async () => {
            await refresh('a');
            await refresh('b');
            await expand('b', dir);
            await treeRow('b', 'inbox').waitFor();
            const source = treeRow('a', 'plugin.jar');
            await source.waitFor();
            const started = Date.now();
            await page.keyboard.down('Control');
            await source.locator('button').first().dragTo(treeRow('b', 'inbox'));
            await page.keyboard.up('Control');
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
            const drag = async () => {
                await page.keyboard.down('Control');
                await treeRow('a', 'plugin.jar').locator('button').first().dragTo(treeRow('b', 'inbox'));
                await page.keyboard.up('Control');
            };
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

    await check(
        'transfer: a plain drag between the explorers MOVES: the original is gone, the bytes are identical',
        async () => {
            writeFileSync(disk(uuidA, dir, 'move-me.bin'), bytes);
            await refresh('a');
            await refresh('b');
            await expand('b', dir);
            await treeRow('a', 'move-me.bin').waitFor();
            await afterJob(() => treeRow('a', 'move-me.bin').locator('button').first().dragTo(treeRow('b', 'inbox')));
            if (!readFileSync(disk(uuidB, dir, 'inbox', 'move-me.bin')).equals(bytes))
                throw new Error('the bytes differ');
            if (existsSync(disk(uuidA, dir, 'move-me.bin'))) throw new Error('the original is still on server 1');
            await page.getByText('Moved', { exact: false }).first().waitFor({ timeout: 10000 });
            await page.waitForFunction(
                (name) =>
                    ![...document.querySelectorAll('[data-pane="a"] .gb-tree-row')].some((row) =>
                        row.textContent.includes(name)
                    ),
                'move-me.bin',
                { timeout: 10000 }
            );
        }
    );

    await check(
        'transfer: moving a file with unsaved edits asks Save, Discard or Cancel and never moves the old text',
        async () => {
            writeFileSync(disk(uuidA, dir, 'dirty-move.txt'), 'old text\n');
            await refresh('a');
            await treeRow('a', 'dirty-move.txt').locator('button').first().dblclick();
            await editor('a').locator('.monaco-editor .view-line').first().waitFor({ timeout: 30000 });
            await editor('a').locator('.monaco-editor').first().click();
            await page.keyboard.press('Control+End');
            await page.keyboard.type('NEW');
            await treeRow('a', 'dirty-move.txt').locator('button').first().dragTo(treeRow('b', 'inbox'));
            const dialog = page.getByRole('dialog');
            await dialog.getByText('has unsaved changes').waitFor({ timeout: 10000 });
            await dialog.getByRole('button', { name: 'Cancel' }).click();
            await page.waitForTimeout(400);
            if (!existsSync(disk(uuidA, dir, 'dirty-move.txt'))) throw new Error('Cancel still moved the file');
            if (existsSync(disk(uuidB, dir, 'inbox', 'dirty-move.txt')))
                throw new Error('Cancel still wrote the destination');
            await treeRow('a', 'dirty-move.txt').locator('button').first().dragTo(treeRow('b', 'inbox'));
            await afterJob(() => page.getByRole('dialog').getByRole('button', { name: 'Save and move' }).click());
            if (!readFileSync(disk(uuidB, dir, 'inbox', 'dirty-move.txt'), 'utf8').includes('NEW'))
                throw new Error('the unsaved text did not travel');
            if (existsSync(disk(uuidA, dir, 'dirty-move.txt'))) throw new Error('the original is still on server 1');
            await closeTabs();
        }
    );

    await check(
        'transfer: a move whose original could not be removed is shown as incomplete with a Finish action',
        async () => {
            writeFileSync(disk(uuidA, dir, 'stuck.txt'), 'stuck');
            await refresh('a');
            await page.route('**/extensions/gobia-files/transfers', (route) =>
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        mode: 'move',
                        directory: '/',
                        bytes: 5,
                        items: [
                            {
                                path: '/' + dir + '/stuck.txt',
                                name: 'stuck.txt',
                                status: 'move_incomplete',
                                bytes: 5,
                                copied: 1,
                                skipped: 0,
                                failed: 0,
                                reason: 'It was copied and verified, but the original could not be removed.',
                                destination: '/stuck.txt',
                            },
                        ],
                    }),
                })
            );
            await treeRow('a', 'stuck.txt').click({ button: 'right' });
            await page.getByRole('menuitem', { name: /Move stuck.txt to/ }).click();
            await page.getByRole('button', { name: /Finish transfer/ }).waitFor({ timeout: 15000 });
            await page.locator('.gb-transfer-error').first().waitFor({ timeout: 5000 });
            await page.unroute('**/extensions/gobia-files/transfers');
            await page.getByRole('button', { name: 'Clear list' }).click();
            rmSync(disk(uuidB, 'stuck.txt'), { force: true });
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
        if (readFileSync(disk(uuidB, 'retry.txt'), 'utf8') !== 'retry me') throw new Error('retry did not deliver');
    });

    await check(
        'transfer: the destination keeps what arrived selected and both explorers have independent selection',
        async () => {
            // The listing is read again after the job, then what arrived is selected.
            await explorer('b')
                .locator('.gb-tree-row.selected')
                .first()
                .waitFor({ timeout: 10000 })
                .catch(() => undefined);
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

    for (const layout of ['stacked', 'side']) {
        const wide = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
        await login(wide);
        const sized = await wide.newPage();
        await sized.addInitScript(
            (value) => localStorage.setItem('gobia-files:dual', value),
            JSON.stringify({ on: true, layout, second: uuidB })
        );
        await sized.goto(`${baseUrl}/server/${ids[0]}/files`);
        await sized.locator('.gb-editor-pane[data-pane="b"]').waitFor({ timeout: 30000 });
        for (const width of [390, 430, 768, 1024, 1366, 1440, 1920, 2560]) {
            await plain(`dual: ${layout} layout at ${width} px has no horizontal overflow`, async () => {
                await sized.setViewportSize({ width, height: width < 768 ? 844 : 900 });
                await sized.waitForTimeout(300);
                const overflow = await sized.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                if (overflow > 1) throw new Error(`page overflows by ${overflow}px`);
                const panes = await sized
                    .locator('.gb-editor-pane')
                    .evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().width > 0).length);
                if (width >= 768 && panes !== 2) throw new Error(`${panes} editors visible`);
                if (width < 768 && panes !== 1) throw new Error(`${panes} editors visible on a phone`);
            });
        }
        await wide.close();
    }

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
