// One-command local Gobia 2 development stack.
//   node scripts/gobia/dev.mjs            (or: npm run dev:gobia)
// Starts, skipping anything already listening: MariaDB, Panel (artisan serve :8000), queue worker, scheduler,
// frontend and extension rebuild-on-change, mock Wings (:8085) and the template SFTP service (:2223).
// Ctrl+C stops everything this script started (MariaDB included). Local development only.
// Toolchain locations come from env (GOBIA_PHP_DIR, GOBIA_MARIADB_DIR, GOBIA_MARIADB_DATA) or the Windows defaults below.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const home = homedir();
const phpDir =
    process.env.GOBIA_PHP_DIR ??
    join(home, 'AppData/Local/Microsoft/WinGet/Packages/PHP.PHP.NTS.8.5_Microsoft.Winget.Source_8wekyb3d8bbwe');
const mariaDir = process.env.GOBIA_MARIADB_DIR ?? join(home, 'devtools/mariadb-11.8.9-winx64');
const mariaData = process.env.GOBIA_MARIADB_DATA ?? join(home, 'devtools/mariadb-data');
const env = {
    ...process.env,
    PATH: [phpDir, join(mariaDir, 'bin'), process.env.PATH].join(delimiter),
    MSYS_NO_PATHCONV: '1',
};
const dotenv = Object.fromEntries(
    readFileSync(join(root, '.env'), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]])
);
const appUrl = new URL(dotenv.APP_URL ?? 'http://localhost:8000');
const children = [];

const listening = (port) =>
    new Promise((ok) => {
        const s = createConnection({ port, host: '127.0.0.1' });
        s.on('connect', () => (s.destroy(), ok(true))).on('error', () => ok(false));
    });
function start(name, command, args, { cwd = root, extraEnv = {} } = {}) {
    const child = spawn(command, args, {
        cwd,
        env: { ...env, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: command.endsWith('.cmd'),
    });
    const tag = `[${name}] `;
    const pipe = (stream) =>
        stream.on('data', (d) =>
            process.stdout.write(
                String(d)
                    .split(/\r?\n/)
                    .filter(Boolean)
                    .map((l) => tag + l)
                    .join('\n') + '\n'
            )
        );
    pipe(child.stdout);
    pipe(child.stderr);
    child.on('exit', (code) => console.log(`${tag}exited (${code})`));
    children.push(child);
}
async function ensure(name, port, launch) {
    if (port && (await listening(port))) return console.log(`[${name}] already running on :${port}, leaving it alone`);
    console.log(`[${name}] starting`);
    launch();
}

await ensure('mariadb', Number(dotenv.DB_PORT ?? 3307), () =>
    start('mariadb', join(mariaDir, process.platform === 'win32' ? 'bin/mariadbd.exe' : 'bin/mariadbd'), [`--defaults-file=${join(mariaData, 'my.ini')}`, '--console'])
);
for (let i = 0; i < 30 && !(await listening(Number(dotenv.DB_PORT ?? 3307))); i++)
    await new Promise((r) => setTimeout(r, 500));

await ensure('panel', Number(appUrl.port || 8000), () =>
    start('panel', 'php', [
        'artisan',
        'serve',
        `--host=${appUrl.hostname}`,
        `--port=${appUrl.port || 8000}`,
        '--no-reload',
    ], {
        // The browser checks load many pages a minute; the production default (256) would answer them with 429. Only this
        // local stack raises it, and GOBIA_API_RATELIMIT overrides the value.
        extraEnv: { APP_API_CLIENT_RATELIMIT: process.env.GOBIA_API_RATELIMIT ?? '4096' },
    })
);
start('queue', 'php', ['artisan', 'queue:work', '--tries=3', '--sleep=1']);
start('scheduler', 'php', ['artisan', 'schedule:work']);
// Rebuild on change instead of `vite build --watch`: the Panel serves built assets through manifest.json (no Vite HMR),
// and the stock watch mode re-triggers itself when the manifest integrity plugin rewrites manifest.json.
const bin = (name) => join(root, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name);
function rebuildOnChange(name, dirs, command, args, opts = {}) {
    let timer = null;
    let running = false;
    let again = false;
    const run = () => {
        if (running) return void (again = true);
        running = true;
        console.log(`[${name}] change detected, rebuilding`);
        const done = () => {
            running = false;
            if (again) {
                again = false;
                run();
            }
        };
        const steps = Array.isArray(command) ? command : [[command, args]];
        const next = (i) => {
            if (i >= steps.length) return done();
            const child = spawn(steps[i][0], steps[i][1], {
                cwd: opts.cwd ?? root,
                env,
                stdio: 'ignore',
                windowsHide: true,
                shell: steps[i][0].endsWith('.cmd'),
            });
            child.on('exit', (code) =>
                code === 0 ? next(i + 1) : (console.log(`[${name}] build failed (${code})`), done())
            );
        };
        next(0);
    };
    for (const dir of dirs)
        watch(dir, { recursive: true }, () => {
            clearTimeout(timer);
            timer = setTimeout(run, 400);
        });
    console.log(`[${name}] watching ${dirs.map((d) => d.replace(root, '.')).join(', ')}`);
}
rebuildOnChange(
    'frontend',
    [
        join(root, 'resources/scripts'),
        join(root, 'resources/gobia'),
        join(root, 'packages/sdk/components'),
        join(root, 'packages/sdk/theme.css'),
    ].filter(existsSync),
    bin('vite'),
    ['build']
);
for (const name of ['gobia-core', 'gobia-templates', 'gobia-files']) {
    const dir = join(root, 'extensions', name);
    if (existsSync(join(dir, 'vite.config.mjs')))
        rebuildOnChange(
            `ext:${name}`,
            [join(dir, 'src')],
            [
                [bin('vite'), ['build']],
                ['php', ['artisan', 'p:extension:enable', name]],
            ],
            [],
            { cwd: dir }
        );
}

const wingsConfig = join(root, 'services/mock-wings/.data/config.yml');
if (existsSync(wingsConfig))
    await ensure('mock-wings', 8085, () => start('mock-wings', 'node', ['services/mock-wings/server.mjs']));
else
    console.log(
        '[mock-wings] skipped: services/mock-wings/.data/config.yml missing (php artisan p:node:configuration 1 > that file)'
    );

if (dotenv.GOBIA_SFTP_SERVICE_TOKEN) {
    const cwd = join(root, 'services/template-sftp/.data');
    mkdirSync(cwd, { recursive: true });
    await ensure('template-sftp', Number(dotenv.GOBIA_SFTP_PORT ?? 2223), () =>
        start('template-sftp', 'node', [join(root, 'services/template-sftp/server.js')], {
            cwd,
            extraEnv: {
                PANEL_URL: appUrl.origin,
                SFTP_SERVICE_TOKEN: dotenv.GOBIA_SFTP_SERVICE_TOKEN,
                SFTP_BIND: '127.0.0.1',
                SFTP_PORT: dotenv.GOBIA_SFTP_PORT ?? '2223',
                TEMPLATE_STORAGE: dotenv.GOBIA_TEMPLATE_STORAGE ?? join(root, 'storage/app/private/templates'),
            },
        })
    );
}

console.log(`\nGobia 2 dev stack up: ${appUrl.origin}  (Ctrl+C to stop)\n`);
const stop = () => {
    for (const c of children) c.kill();
    setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
