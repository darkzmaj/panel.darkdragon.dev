// Gobia extension tooling, kept outside upstream files.
//   node scripts/gobia/run.mjs build       build every extensions/gobia-* frontend (dist/client.js)
//   node scripts/gobia/run.mjs test        run the Gobia Vitest projects
//   node scripts/gobia/run.mjs tsc         type check every Gobia extension
//   node scripts/gobia/run.mjs lint        oxlint + oxfmt check on the Gobia extension sources
//   node scripts/gobia/run.mjs all         tsc, lint, test, build in that order
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = (name) => join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const extensions = readdirSync(join(root, 'extensions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('gobia-') && existsSync(join(root, 'extensions', entry.name, 'extension.json')))
    .map((entry) => entry.name);

function run(command, args, cwd = root) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) {
        console.error(`\n${command} ${args.join(' ')} failed in ${cwd}`);
        process.exit(result.status ?? 1);
    }
}

const tasks = {
    build: () => extensions.forEach((name) => existsSync(join(root, 'extensions', name, 'vite.config.mjs')) && run(bin('vite'), ['build'], join(root, 'extensions', name))),
    test: () => run(bin('vitest'), ['run', '--config', 'vitest.gobia.config.ts']),
    tsc: () => extensions.forEach((name) => existsSync(join(root, 'extensions', name, 'tsconfig.json')) && run(bin('tsc'), ['-p', join('extensions', name, 'tsconfig.json')])),
    lint: () => {
        const sources = extensions.map((name) => join('extensions', name, 'src', 'client'));
        run(bin('oxfmt'), ['--check', ...sources]);
        run(bin('oxlint'), sources);
    },
};
tasks.all = () => ['tsc', 'lint', 'test', 'build'].forEach((task) => tasks[task]());

const task = process.argv[2];
if (!tasks[task]) {
    console.error(`Usage: node scripts/gobia/run.mjs <${Object.keys(tasks).join('|')}>`);
    process.exit(2);
}
console.log(`Gobia extensions: ${extensions.join(', ') || '(none)'}`);
tasks[task]();
