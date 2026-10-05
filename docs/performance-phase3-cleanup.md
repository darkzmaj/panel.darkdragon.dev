# Phase 3 cleanup: performance

Same method and machine as docs/performance-phase3-redesign.md (headless Chromium over 127.0.0.1, PHP dev server, 2 runs, median). Cells read **before cleanup / after cleanup**. Differences of tens of milliseconds are noise.

| Page | Cold ready (ms) | JS requests | JS KB | All requests | All KB |
| --- | --- | --- | --- | --- | --- |
| Login | 247 / 238 | 3 / 3 | 575 / 573 | 13 / 11 | 771 / 748 |
| Dashboard (instance list) | 1696 / 1999 | 5 / 5 | 781 / 785 | 26 / 25 | 1,041 / 1,049 |
| Account | 1078 / 1161 | 8 / 8 | 942 / 946 | 20 / 20 | 1,264 / 1,274 |
| Admin overview | 243 / 236 | 9 / 9 | 232 / 234 | 25 / 25 | 663 / 675 |
| Server page (console) | n/a / n/a | 13 / 13 | 1,697 / 1,697 | 26 / 26 | 1,917 / 1,923 |
| Files (before Monaco) | 1250 / 1294 | 10 / 10 | 1,682 / 1,681 | 24 / 24 | 1,906 / 1,910 |
| Files with Monaco | 1768 / n/a | 13 / 13 | 5,336 / 5,333 | 30 / 28 | 5,571 / 5,564 |

The Files-with-Monaco row reads n/a after the cleanup because the test file had been deleted by an earlier UI test; Monaco itself opened in about 1.5 s when re-measured with the file present. The console row has no timing because the mock Wings has no websocket.

## Route switches (ms)

| Page | First round | Second round (warm) |
| --- | --- | --- |
| files | 23 / 16 | 17 / 11 |
| databases | 16 / 11 | 10 / 7 |
| backups | 20 / 16 | 8 / 7 |
| network | 12 / 12 | 9 / 8 |
| settings | 44 / 49 | 9 / 7 |
| startup | 16 / 20 | 12 / 8 |
| schedules | 11 / 12 | 10 / 7 |
| activity | 16 / 16 | 8 / 8 |
| console | 16 / 16 | 18 / 14 |

## Menus

Opening the file row menu took 2-3 ms to the first painted frame (5 samples). Motion was shortened: hover 100 ms, popover/menu and modal 120 ms, sidebar 160 ms, upload progress 120 ms; reduced-motion is respected.

## Changes that affect speed

* Account pages are preloaded on hover/focus of the Account link and its sub-menu (they share one chunk).
* Moving files updates the list immediately and revalidates afterwards.
* A 409 while an instance installs is no longer logged as an error.

Not measured: render counts, memory, gzip sizes. Navigation was already near-instant when warm, so no structural change was needed.
