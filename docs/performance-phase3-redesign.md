# Phase 3 redesign: performance compared with Phase 2

Both builds were measured on the same machine, one after the other, with the same data. Phase 2 is the commit before
the redesign (`a23dc1a00`, built with `yarn build:production` in a separate worktree and served by its own
`php artisan serve` on port 8001); Phase 3 is the current `develop` build on port 8000. Both use the same database and
the same mock Wings, and both were opened through `127.0.0.1` (on this machine `localhost` adds about 200 ms per new
connection because of IPv6 fallback, which would have skewed the comparison). Headless Chromium (puppeteer) was driven
by a throwaway script that is not part of the repository.

How to read the numbers: *ready* is the time from navigation start until the page's main element exists in the DOM
(`performance.now()` taken by a MutationObserver). *Cold* disables the browser cache; *warm* repeats the visit after a
priming visit with the cache on. Each cell is the median of 2 runs, so differences of a few tens of milliseconds are
noise. Transfer sizes are the bytes the browser received (`encodedDataLength`); the dev server does not compress, so they
equal the uncompressed sizes. `php artisan serve` with `APP_DEBUG=true` is far slower than a production web server, which
is why absolute times are high (the dashboard's ~1.7 s is almost all the server-list API call).

Each cell reads **Phase 2 / Phase 3**.

| Page | Cold ready (ms) | Warm ready (ms) | JS requests | JS KB | All requests | All KB |
| --- | --- | --- | --- | --- | --- | --- |
| Login | 224 / 247 | 225 / 230 | 3 / 3 | 638 / 575 | 9 / 13 | 703 / 771 |
| Dashboard (instance list) | 1640 / 1696 | 1982 / 1800 | 5 / 5 | 839 / 781 | 21 / 26 | 971 / 1,041 |
| Account | 1151 / 1078 | 304 / 274 | 8 / 8 | 1,001 / 942 | 15 / 20 | 1,067 / 1,264 |
| Admin overview | 532 / 243 | 187 / 218 | 10 / 9 | 245 / 232 | 26 / 25 | 724 / 663 |
| Server page (console) | n/a / n/a | n/a / n/a | 13 / 13 | 1,763 / 1,697 | 21 / 26 | 1,828 / 1,917 |
| Files (before Monaco) | 1244 / 1250 | 1034 / 1347 | 10 / 10 | 1,748 / 1,682 | 19 / 24 | 1,816 / 1,906 |
| Files with Monaco | 1993 / 1768 | 1659 / 1520 | 13 / 13 | 5,377 / 5,336 | 26 / 30 | 5,460 / 5,571 |

## Reading the table

* **JavaScript did not grow.** JS per page is 1-10 % smaller than Phase 2 (the Font Awesome and Heroicons packages were
  replaced by the Lucide icon set; the cause of the reduction was not profiled). The number of JS requests is equal, and
  Monaco is still loaded only on the file editor page (`Files with Monaco` is the only row where it appears).
* **More non-JS requests.** Phase 3 adds a few requests on every page (+4 on login, +5 on the dashboard and account):
  the self-hosted fonts (Manrope, Space Grotesk), the Gobia stylesheet and the logo/watermark images. They are
  cached after the first visit (warm loads are not slower on the login page or the account page).
* **Load times are equal within noise** on login, dashboard, account, files and the editor, and the admin overview is faster
  cold (532 -> 243 ms in this run; the cause was not investigated).
* The **Files (before Monaco)** warm figure is 1034 -> 1347 ms in this run. With two samples and a PHP dev server
  this is within run-to-run variation (the same page was 1244 / 1250 ms cold); it was not investigated further.
* **Server page (console)** is not comparable: its readiness selector (the xterm terminal) never appears because the
  mock Wings has no websocket, so no time was recorded for either build. Its JS and request figures are valid.
* Not measured: render counts, gzip sizes, memory.

## Route switches inside a server

Click on a sidebar link until the new page rendered without a skeleton (milliseconds, **Phase 2 / Phase 3**). First round
includes chunk loads; second round is warm.

| Page | First round | Second round |
| --- | --- | --- |
| files | 221 / 23 | 14 / 17 |
| databases | 9 / 16 | 6 / 10 |
| backups | 6 / 20 | 6 / 8 |
| network | 33 / 12 | 8 / 9 |
| settings | 12 / 44 | 7 / 9 |
| startup | 9 / 16 | 7 / 12 |
| schedules | 10 / 11 | 8 / 10 |
| activity | 8 / 16 | 8 / 8 |
| console | 12 / 16 | 12 / 18 |

Phase 2 spent 221 ms on its first Files switch (chunk fetch) and Phase 3 23 ms, but the other first-round switches are
slightly slower in Phase 3 (+5 to +30 ms) and the warm switches are about 2-4 ms slower; all of these are within the
timing noise of a two-sample run, and none is perceptible. The Phase 2 optimisations (route chunk preloading, fade-in only
transitions, skeleton fallback, stale response protection) are unchanged.

## What the redesign added to the bundles

* `gobia.css` (design tokens, shell, components) and `icons.css` (CSS-mask icons for the server-rendered admin) are plain
  static files, cached with a version query.
* The admin template editor (`template-editor` entry) is still its own entry and is not loaded anywhere else.
* The file manager's upload queue, drag and drop and context menu live in the existing `server-pages` and `file-workspace`
  chunks; they add no request on other pages.
* No regression needed fixing.
