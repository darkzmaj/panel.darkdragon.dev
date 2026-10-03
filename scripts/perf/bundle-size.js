// Prints raw/gzip/brotli sizes of the compiled production assets. Usage: node scripts/perf/bundle-size.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const dir = path.join(__dirname, '../../public/assets');
const kb = (n) => (n / 1024).toFixed(1).padStart(8);
const rows = fs
    .readdirSync(dir)
    .filter((f) => /\.(js|css|woff2?)$/.test(f))
    .map((f) => {
        const data = fs.readFileSync(path.join(dir, f));
        return { f, raw: data.length, gzip: zlib.gzipSync(data, { level: 9 }).length, br: zlib.brotliCompressSync(data).length };
    })
    .sort((a, b) => b.raw - a.raw);

console.log('file'.padEnd(34), '     raw KB', '  gzip KB', '    br KB');
for (const r of rows) console.log(r.f.padEnd(34), kb(r.raw), kb(r.gzip), kb(r.br));
const sum = (k) => rows.filter((r) => r.f.endsWith('.js')).reduce((a, r) => a + r[k], 0);
console.log('TOTAL JS'.padEnd(34), kb(sum('raw')), kb(sum('gzip')), kb(sum('br')));
