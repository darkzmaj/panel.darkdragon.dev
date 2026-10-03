# Performance after optimization

Same method and machine as [`performance-baseline.md`](performance-baseline.md): production webpack build, `php artisan serve`
without compression or HTTP caching, cold loads measured with the browser's Resource Timing API (`encodedBodySize`).
Percentages are relative to the baseline. Nothing here is estimated except where marked.

## What changed

- `optimization.sideEffects` was `false`, which made webpack ignore package `sideEffects` flags; set to `true` so barrel
  files (`date-fns`, `@heroicons/react`) are pruned. Development-only `react-hot-loader` is no longer part of production.
- `routers/routes.ts` imported every server page *and* every account page, and the dashboard router imported it, so the
  dashboard shipped the whole server UI (xterm, chart.js, file manager, ...). It is split into `accountRoutes.ts` and
  `serverRoutes.ts`; non-landing pages load on first visit in two chunks (`account-pages`, `server-pages`).
- `splitChunks.minSize` raised to 60 KB so tiny shared modules stop becoming requests of their own.
- Avatars have a 64 px thumbnail (`?s=64`, own ETag) for icon-sized uses.
- Dashboard stats polling pauses in background tabs and no longer leaks a timer when a row unmounts early.
- Settings are cached instead of queried on every request; admin theme assets get real cache-busting; the admin loads
  Font Awesome from the Panel itself (no CDN) and the unused Ionicons stylesheet is gone.

## Build

| Metric | Before | After |
|---|---|---|
| `yarn tsc` | 4.5 s | 4.6 s (unchanged) |
| webpack production compile (3 runs, warm disk) | 14.4 / 14.7 / 15.7 s | 13.7 / 14.1 / 14.2 s (-4 %, within noise) |
| `yarn build:production` wall time incl. `clean` | 53.8 s (cold disk, single run) | not comparable; warm runs ~15 s |
| Emitted JS files | 18 | 22 |
| Total JS, all chunks | 2665 KB raw / 740 KB gzip | 2537 KB raw / 738 KB gzip (-5 % raw, ~0 % gzip) |

Total emitted JavaScript barely changed: the gain is in what a page has to download, not in how much code exists.

## Page loads (cold, first party, raw bytes)

| Page | Metric | Before | After | Difference |
|---|---|---|---|---|
| Login | JS | 650 KB | 643 KB | -1 % |
| Login | requests (excl. reCAPTCHA) | 7 | 7 | 0 |
| Dashboard | JS | 2031 KB (5 files) | 824 KB (5 files) | -1207 KB (-59 %) |
| Dashboard | total transferred | 2.16 MB | 880 KB | -1.28 MB (-59 %) |
| Dashboard | requests | 10 | 10 | 0 |
| Account | JS | 2031 KB (5 files) | 973 KB (7 files) | -1058 KB (-52 %) |
| Account | total transferred | 2.17 MB | 1.12 MB | -1.05 MB (-48 %) |
| Account | requests | 9 | 12 | +3 (worse) |
| Admin | requests | 22 (2 on a CDN) | 22 (0 on a CDN) | CDN requests -2 |
| Admin | total transferred | 705 KB | 721 KB | +16 KB (+2 %, worse) |
| Any page showing the avatar at icon size | avatar bytes | 87 KB | 7 KB | -92 % |

Notes on the worse numbers: the account page now needs the lazily loaded `account-pages` chunk after the dashboard chunk
runs (one extra step in the request waterfall, +3 requests), which is the cost of not loading it on the dashboard. The admin
total grew because the Font Awesome *font file* (77 KB), which used to come from a CDN and was not counted, is now served by
the Panel; the 87 KB avatar there dropped to 7 KB, which hides most of that.

Load-event times on localhost were 1.2 s before and after on dashboard/account/login; they are dominated by the
single-threaded dev server, so no speed-up is claimed from them.

## Requests and polling

- Duplicate identical API calls on initial load: 0 before, 0 after (none existed).
- Dashboard stats polling: unchanged cadence (30 s per visible server) while the tab is visible; **0 requests** while hidden.
- Settings table queries per request: 1 -> 0 on a warm cache.
- Server page (console, files): needs a Wings node and could not be loaded here, so no measurement; statically the
  console chunk is `server` + one shared chunk and the file/schedule/backup pages no longer load with it.

## Not done / not measured

- No HTTP compression or long-lived caching headers for `/assets` can be demonstrated with the dev server; production
  nginx should enable gzip/brotli and `Cache-Control: immutable` for hashed assets (gzip total JS across the dashboard
  path: 522 KB -> about 250 KB, computed from `scripts/perf/bundle-size.js`, not measured over a network).
- No webpack -> Vite migration: it could not be justified by measurement within this task.
- No dependency was removable: `depcheck` found only `events`, which `Websocket.ts` imports.
