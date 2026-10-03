// Summarises which packages make up each chunk. Usage: node scripts/perf/chunk-report.js <webpack-stats.json> [topN]
const path = require('node:path');
const stats = require(path.resolve(process.argv[2]));
const top = Number(process.argv[3] || 8);

for (const chunk of stats.chunks.sort((a, b) => b.size - a.size).slice(0, 8)) {
    const pkgs = {};
    const walk = (m) => {
        if (m.modules) return m.modules.forEach(walk);
        const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec((m.name || '').replace(/\\/g, '/'));
        const key = match ? match[1] : 'app code';
        pkgs[key] = (pkgs[key] || 0) + m.size;
    };
    chunk.modules.forEach(walk);
    console.log(
        `\n${chunk.names.join(',') || chunk.id} (${chunk.files.join(',')})  ${(chunk.size / 1024).toFixed(0)} KB pre-minify  initial=${chunk.initial}`
    );
    Object.entries(pkgs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .forEach(([k, v]) => console.log('   ', (v / 1024).toFixed(0).padStart(6), 'KB', k));
}
