// Structural performance budgets for the production build (run `yarn build:production` first):
//   node scripts/check-bundle-budget.js
// Limits are the measured sizes with some headroom. They are file sizes, not timings, so they never flake.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../public/assets');
const KB = 1024;
const budgets = [
    // The chunk every page loads.
    { match: /^bundle\./, max: 520 * KB, why: 'main bundle (login, dashboard, shell)' },
    { match: /^server-pages\./, max: 140 * KB, why: 'server sub-pages chunk' },
    { match: /^template-editor\./, max: 190 * KB, why: 'admin template editor entry' },
];
let failed = false;
const files = fs.readdirSync(dir);
for (const { match, max, why } of budgets) {
    const hit = files.filter((f) => match.test(f) && f.endsWith('.js'));
    if (!hit.length) { console.log(`skip   ${why}: not found`); continue; }
    for (const f of hit) {
        const size = fs.statSync(path.join(dir, f)).size;
        const ok = size <= max;
        failed = failed || !ok;
        console.log(`${ok ? 'ok    ' : 'OVER  '} ${f} ${(size / KB).toFixed(0)} KB (budget ${(max / KB).toFixed(0)} KB) ${why}`);
    }
}
// Monaco must stay out of the common entry chunks: only the editor chunk and the workers may mention it.
const main = files.filter((f) => /^(bundle|server-pages)\./.test(f) && f.endsWith('.js'));
for (const f of main) {
    if (/monaco-editor\/esm/.test(fs.readFileSync(path.join(dir, f), 'utf8'))) { failed = true; console.log(`OVER   ${f} contains Monaco`); }
}
process.exit(failed ? 1 : 0);
