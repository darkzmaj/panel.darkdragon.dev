// Attributes the real (minified) bytes of a bundle to packages using source-map-explorer's JSON output.
// Usage: npx source-map-explorer <bundle.js> --json | node scripts/perf/sourcemap-report.js
const input = require('node:fs').readFileSync(0, 'utf8');
const result = JSON.parse(input).results[0];
const packages = {};

for (const [file, { size }] of Object.entries(result.files)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file.replace(/\\/g, '/'));
    const key = match ? match[1] : file.includes('resources') ? 'app code' : file;
    packages[key] = (packages[key] || 0) + size;
}

console.log(result.bundleName, (result.totalBytes / 1024).toFixed(1), 'KB');
Object.entries(packages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.argv[2] || 20))
    .forEach(([name, size]) => console.log((size / 1024).toFixed(1).padStart(8), 'KB', name));
