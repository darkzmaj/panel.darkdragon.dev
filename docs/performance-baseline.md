# Performance baseline (before optimization)

Measured on 2026-10-03 against the Phase 1 build (`1.15.1-gobia.1` before optimization), production webpack build,
served by `php artisan serve` on localhost with no compression and no HTTP caching (so byte counts below are raw
bodies; gzip/brotli figures are computed with `scripts/perf/bundle-size.js`). Page figures come from the browser's
Resource Timing API on a cold load (`encodedBodySize`). Third-party reCAPTCHA traffic on the login page is excluded
from first-party totals but listed separately.

Tools: `node scripts/perf/bundle-size.js`, `node scripts/perf/chunk-report.js <webpack --json output>`.

## Build

| Metric | Value |
|---|---|
| `yarn build:production` (incl. `clean`) | 53.8 s |
| `yarn tsc` | 4.5 s |

## Production JavaScript (all emitted chunks)

| Metric | Raw | gzip | brotli |
|---|---|---|---|
| Total JS, 18 files | 2665 KB | 740 KB | 615 KB |
| Main entry `bundle.*.js` | 515 KB | 158 KB | 135 KB |
| Shared chunk `972` | 1094 KB | 273 KB | 223 KB |
| CodeMirror chunk `24` | 535 KB | 171 KB | 142 KB |
| App chunk `168` (server/dashboard pages) | 269 KB | 59 KB | 47 KB |
| formik/yup/lodash chunk `478` | 92 KB | 28 KB | 25 KB |

CSS is injected from JS by `style-loader`; there is no separate stylesheet for the React app.

## What is inside the big chunks (pre-minify sizes from webpack stats)

- Main: `@fortawesome/free-solid-svg-icons` 695 KB of 1641 KB (the whole icon set, only ~60 icons are used), axios 107, react-dom 118, i18next 79.
- Chunk `972` (loaded by the dashboard): `date-fns` 557 KB, `chart.js` 404, `xterm` 380, `framer-motion` 379, `@heroicons/react` 328 (whole packages, not tree-shaken).
- Chunk `24`: CodeMirror 1092 KB (already lazy, only used by file editor/schedules).
- Root cause: `optimization.sideEffects: false` in `webpack.config.js` tells webpack to *ignore* package `sideEffects`
  flags, so barrel files (`index.js` re-exporting every icon/function) cannot be pruned.
- Development-only `react-hot-loader` (entry, babel plugin, `@hot-loader/react-dom` alias) is part of the production build.

## Page loads (cold, first-party)

| Page | Requests | JS requests | JS raw | Total raw | Notes |
|---|---|---|---|---|---|
| Login `/auth/login` | 11 (4 are reCAPTCHA) | 3 | 1005 KB | 1065 KB incl. 355 KB reCAPTCHA | 12.8 KB logo SVG; load event 1.18 s |
| Dashboard `/` | 10 | 5 | 2031 KB | 2.16 MB | 1 API call (`/api/client`), + 1 stats call per server every 30 s; load 1.21 s |
| Account `/account` | 9 | 5 | 2031 KB | 2.17 MB | 0 API calls; the avatar `<img>` is the 256 px original (87 KB) shown at 20-80 px |
| Admin `/admin` | 22 (2 on a CDN) | 10 JS | 249 KB JS | 705 KB | 9 stylesheets, Font Awesome + Ionicons from cdnjs; avatar 87 KB shown at 20 px |

Account and dashboard load the same 2 MB of JavaScript because every authenticated route sits behind the shared chunk.

## Request / state audit findings

- Duplicate identical API calls on initial load: 0 observed on dashboard/account.
- Dashboard `ServerRow` polls `/resources` every 30 s per server even when the tab is hidden, and the interval is
  assigned inside a `.then()` so an unmount before the first response leaks the timer.
- `?t={cache-version}` on admin theme assets is never substituted, so those URLs never change between releases.
- `SettingsServiceProvider` queries the `settings` table on every request.
- The server page (console/files) needs a Wings node and could not be loaded here; statically it pulls `server` (51 KB) plus chunk `972` (xterm, chart.js).
