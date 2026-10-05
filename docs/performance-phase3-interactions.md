# Phase 3 interactions: input latency, dashboard rendering and clicks

Measured in headless Chromium against the local Panel (`127.0.0.1:8000`, PHP dev server, mock Wings), production build.
The dashboard list is paginated (15 rows per page by default, `APP_PAGINATE_FRONT_SERVERS`), so the rendered list never
grows beyond one page; that is why no virtualization was added. To check the worst case the profile below used 50 rows.

## What was profiled

A script drove the dashboard with 50 rows and recorded Event Timing, long tasks and the browser's own script/layout
counters while it opened the category editor, switched the All/You filter, opened the row context menu five times and
dragged a row.

| Measure | Result |
| --- | --- |
| Long tasks (>50 ms) during all interactions | 0 |
| Script time for the whole interaction run | 69 ms |
| Layout time / layout passes for the run | 18 ms / 90 |
| Context menu open (right click to menu in the DOM, 5 samples, includes the test round trip) | 17, 10, 11, 9, 9 ms |
| Open category editor and close it | about 300 ms including the test's own waits |
| Mouse drag, 20 pointer moves including setup | about 100 ms in total, no long task |
| Slowest single input event | 64 ms (`pointerup` of the drag, which commits the order and saves it) |

"Before" numbers for input latency were not captured, because the earlier measurements only timed route changes. The
figures above are therefore the after state. Rendering during a drag is not React work any more: the list moves rows with
CSS transforms and re-renders once, on release.

## Findings and fixes

* **Live numbers.** Every row used to run its own 30 second timer and fire its own request on mount. Rows now subscribe to
  one shared hub (`statsHub.ts`) that fetches four at a time, once per interval, only for rows near the viewport and not
  while the tab is hidden. Several rows showing the same server share one request. Over a 33 second idle window the 50-row test page made 13 requests
  (one per distinct server). A WebSocket stream per server is not available for the list, so one request per visible server
  per 30 s remains the floor.
* **Rows re-rendering.** `ServerRow` is memoized and the list is memoized, so one row's new numbers no longer redraw its siblings.
* **Dead clicks.** A static scan (`elementFromPoint` at the centre of every visible control on the main pages at 1440 and 390 px)
  found no control covered by another element. The real cause found was the touch bottom sheet: lifting the finger that
  opened it sent a click to the backdrop, which closed the sheet immediately. Backdrop clicks in the first 500 ms are
  now ignored. The old colour dialog also closed on every colour click and, with the native colour input, on every
  step of the picker; it now only selects until Apply.
* **Scroll vs. drag on touch.** Touch rows use pointer events with timers (see below); a swipe that starts on a row
  scrolls the page and never starts a drag or a menu.
* **Admin tables.** Rows turned light grey on hover in dark mode because Bootstrap (`.table-hover > tbody > tr:hover`,
  `#f5f5f5`) and the old Pterodactyl theme (`#33404d`) painted the whole `<tr>`, and the Gobia cell colour, which is
  translucent, was drawn over it. The row is never painted now and the cell uses the `--gb-hover` token. Verified by
  sampling the rendered pixels under a hovered row in dark (`20,28,39`) and light (`243,246,249`) on Nodes, Locations,
  Instances, instance details, Users, Nests, Templates and Databases.

## Touch timings

Hold still 500 ms: the row is highlighted (and a short vibration where supported). 1.2 s: the row lifts. Move the
finger after that: drag. Keep holding without moving until 2.3 s: the action sheet opens instead. Moving more than 8 px
before the lift cancels everything and the page scrolls. The numbers are constants at the top of
`SortableServerList.tsx`.

## Not measured

Per-component render counts (no React profiler build was run), memory, and a before/after for input latency.
