// The four status dots (power, CPU, memory, storage) on the instance list and in the instance card of the sidebar:
// they must follow Wings within a moment, with the colours and flashing the thresholds ask for.
// Uses the development mock Wings, whose `mock-stats` endpoint forces the numbers a running instance reports.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIB = 1024 * 1024;

function mockToken(root) {
    const config = readFileSync(join(root, 'services/mock-wings/.data/config.yml'), 'utf8');
    return config
        .match(/^token:\s*(.+)$/m)?.[1]
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

export async function statusFlows({ browser, context, login, scheme, baseUrl, root, check: plain }) {
    const token = mockToken(root);
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
    const row = page.locator('li.gb-server-item').first();
    await row.waitFor({ timeout: 30000 });
    const uuid = await row.getAttribute('data-instance');
    const identifier = (await row.locator('a.gb-server-row').getAttribute('href')).split('/')[2];
    const mock = (body) =>
        page.request.post(`http://localhost:8085/api/servers/${uuid}/mock-stats`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            data: body,
        });
    const level = (dot) => row.locator(`[data-dot="${dot}"]`).getAttribute('data-level');
    const waitLevel = async (dot, expected, ms = 4000) => {
        const started = Date.now();
        await page.waitForFunction(
            ([id, name, want]) =>
                document.querySelector(`li[data-instance="${id}"] [data-dot="${name}"]`)?.getAttribute('data-level') ===
                want,
            [uuid, dot, expected],
            { timeout: ms }
        );
        return Date.now() - started;
    };
    const power = async (signal) => {
        const xsrf = decodeURIComponent(
            (await context.cookies(baseUrl)).find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? ''
        );
        await page.request.post(`${baseUrl}/api/client/servers/${uuid}/power`, {
            headers: { 'X-XSRF-TOKEN': xsrf, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
            data: { signal },
        });
    };

    await check('status: every instance row has four dots', async () => {
        const rows = await page.locator('li.gb-server-item').count();
        const dots = await page.locator('li.gb-server-item .gb-sdot').count();
        if (rows === 0 || dots !== rows * 4) throw new Error(`${dots} dots for ${rows} rows`);
    });

    await check(
        'status: the power dot follows start and stop within a moment and every dot flashes while on and sits red while off',
        async () => {
            await mock({});
            await power('stop');
            await waitLevel('power', 'max', 8000);
            for (const dot of ['power', 'cpu', 'memory', 'disk']) {
                const cls = await row.locator(`[data-dot="${dot}"]`).getAttribute('class');
                const want = dot === 'power' ? 'max' : 'idle';
                if (cls.includes('flash') || (await level(dot)) !== want)
                    throw new Error(
                        `an offline instance: ${dot} must be steady ${want === 'max' ? 'red' : 'blank'}, got ${cls}`
                    );
            }
            await power('start');
            const took = await waitLevel('power', 'high', 6000).catch(() => null);
            const upMs = await waitLevel('power', 'ok', 8000);
            for (const dot of ['power', 'cpu', 'memory', 'disk']) {
                if (!(await row.locator(`[data-dot="${dot}"]`).getAttribute('class')).includes('flash'))
                    throw new Error(`the running ${dot} dot does not flash`);
            }
            console.log(`  power dot: starting after ${took ?? 'n/a'} ms, running after ${upMs} ms`);
        }
    );

    await check(
        'status: CPU, memory and storage dots turn yellow when high and red at the limit, within two seconds',
        async () => {
            // The development instance has a 100 percent CPU, 1 GiB memory and 2 GiB storage limit (see docs).
            await mock({ cpu: 20, memory: 100 * MIB, disk: 100 * MIB });
            await waitLevel('cpu', 'ok');
            await waitLevel('memory', 'ok');
            await waitLevel('disk', 'ok');
            await mock({ cpu: 85, memory: 850 * MIB, disk: 1700 * MIB });
            const high = await Promise.all([
                waitLevel('cpu', 'high', 2500),
                waitLevel('memory', 'high', 2500),
                waitLevel('disk', 'high', 2500),
            ]);
            for (const dot of ['cpu', 'memory', 'disk']) {
                if (!(await row.locator(`[data-dot="${dot}"]`).getAttribute('class')).includes('flash'))
                    throw new Error(`${dot} does not flash when high`);
            }
            await mock({ cpu: 130, memory: 1100 * MIB, disk: 2100 * MIB });
            const max = await Promise.all([
                waitLevel('cpu', 'max', 2500),
                waitLevel('memory', 'max', 2500),
                waitLevel('disk', 'max', 2500),
            ]);
            console.log(`  to yellow in ${Math.max(...high)} ms, to red in ${Math.max(...max)} ms`);
            const color = await row
                .locator('[data-dot="cpu"]')
                .evaluate((element) => getComputedStyle(element).backgroundColor);
            if (!/rgb\(/.test(color)) throw new Error(`cpu dot colour ${color}`);
            await mock({});
        }
    );

    const rhythm = (scope) =>
        scope.locator('.gb-sdot.flash').evaluateAll((nodes) =>
            nodes.map((node) => ({
                dot: node.dataset.dot,
                duration: node.style.getPropertyValue('--flash-d'),
                delay: node.style.getPropertyValue('--flash-delay'),
            }))
        );
    let listRhythm = [];
    await check('status: the dots flash at four different speeds and none in step', async () => {
        await mock({});
        await power('start');
        await waitLevel('power', 'ok', 8000);
        await page.waitForTimeout(300);
        listRhythm = await rhythm(row);
        if (listRhythm.length !== 4) throw new Error(`${listRhythm.length} dots flash`);
        if (new Set(listRhythm.map((dot) => dot.duration)).size !== 4)
            throw new Error(`speeds repeat: ${JSON.stringify(listRhythm)}`);
        if (new Set(listRhythm.map((dot) => dot.delay)).size !== 4) throw new Error('two dots start together');
        // Only opacity moves, so the browser can run it on the compositor without repainting.
        const animation = await row
            .locator('[data-dot="cpu"]')
            .evaluate((node) => getComputedStyle(node).animationName);
        if (animation !== 'gb-flash') throw new Error(`animation ${animation}`);
    });

    await check(
        'status: the instance card in the sidebar shows the same four dots, stacked, and they follow too',
        async () => {
            await page.goto(`${baseUrl}/server/${identifier}`);
            const card = page.locator('.gb-sidebar .gb-subcard, aside .gb-subcard').first();
            await card.locator('.gb-dots-vertical').waitFor({ timeout: 30000 });
            if ((await card.locator('.gb-sdot').count()) !== 4) throw new Error('the card needs four dots');
            const boxes = await card
                .locator('.gb-sdot')
                .evaluateAll((nodes) =>
                    nodes.map((node) => node.getBoundingClientRect()).map((box) => ({ x: box.x, y: box.y }))
                );
            if (
                new Set(boxes.map((box) => Math.round(box.x))).size !== 1 ||
                new Set(boxes.map((box) => Math.round(box.y))).size !== 4
            )
                throw new Error('the dots are not stacked vertically');
            const cardRhythm = await rhythm(card);
            if (cardRhythm.length === 0) throw new Error('the instance card dots do not flash while the instance runs');
            for (const dot of cardRhythm) {
                const same = listRhythm.find((entry) => entry.dot === dot.dot);
                if (same && same.duration !== dot.duration)
                    throw new Error(
                        `${dot.dot} flashes at ${dot.duration} in the card and ${same.duration} in the list`
                    );
            }
            await mock({ cpu: 130, memory: 100 * MIB, disk: 100 * MIB });
            await page.waitForFunction(
                () =>
                    document.querySelector('aside .gb-subcard [data-dot="cpu"]')?.getAttribute('data-level') === 'max',
                null,
                { timeout: 4000 }
            );
            await mock({});
        }
    );
    await page.close();

    // Phone: the row keeps its dots and the metrics stay inside the screen.
    const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: scheme,
        hasTouch: true,
        isMobile: true,
    });
    await login(phone);
    const small = await phone.newPage();
    await plain('status: the instance list fits a 390 px phone with its dots', async () => {
        await small.goto(baseUrl + '/');
        await small.locator('li.gb-server-item').first().waitFor({ timeout: 30000 });
        const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) throw new Error(`page overflows by ${overflow}px`);
        if ((await small.locator('li.gb-server-item .gb-sdot').count()) < 4) throw new Error('no dots on the phone');
    });
    await phone.close();
}
