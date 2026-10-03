# Phase 2 hardening: navigation performance

Measured in the dev panel (`yarn build:production`, Chromium Browser pane, localhost, mock Wings). The numbers are
single-machine timings from a script that clicks the server sub-navigation links and waits for the URL to change and
the page `<section>` to render without a loading skeleton. They show the order of magnitude, not a benchmark suite.

## Root causes found

| Cause | Effect |
| --- | --- |
| `TransitionRouter` used `SwitchTransition mode="out-in"` with a 150 ms fade | every navigation waited 150 ms for the old page to fade out before the new page mounted |
| Route chunks were only fetched after the click | first visit to each page waited for a network round trip (~1.9-2.2 s cold) |
| `Spinner.Suspense` full-page spinner as route fallback | navigation looked frozen / flashed a spinner |
| `getServer` response applied unconditionally | a late response for a previous server could overwrite the server on screen |

## Fixes

- `TransitionRouter`: fade-in only (100 ms); the previous page is replaced immediately.
- `plugins/lazyWithPreload.ts`: `React.lazy` with a `preload()` handle. Server routes expose it; sub-navigation links
  preload on hover and focus; the shared `server-pages` chunk is fetched when the browser is idle after a server opens.
  The Monaco workspace (`file-workspace`, `monaco-editor`) is never idle-preloaded.
- `components/elements/RouteSuspense.tsx`: skeleton fallback instead of a spinner.
- `state/server/index.ts`: request counter; stale `getServer` responses are discarded, and leaving a server invalidates
  in-flight requests.

## Before / after

| Measure | Before | After |
| --- | --- | --- |
| Warm page switch (chunk already loaded) | ~170-190 ms | ~15-30 ms |
| Cold first visit to a server sub-page | ~1.9-2.2 s | chunk prefetched when idle; first Files visit incl. API call ~600 ms |
| New requests per warm switch | 1 (page API call) | 0-1 (page API call) |
| Rapid Files/Console/Files/Settings/Files/Console/Settings/Files at 25 ms spacing | not measured | ends on Files, no skeleton or stale data left |
| Monaco loaded on server list / account / login / non-Files pages | no | no (verified: only `server-pages` loaded after the run) |

Production bundle (uncompressed) after the change: `bundle` 529 KB, `server-pages` 140 KB, `config-validators` 109 KB
(YAML/TOML parsers, loaded only by the file workspace). Monaco and its workers live in separate chunks fetched only
when the file workspace opens.

Not measured: render counts per navigation (no profiler run was done), gzip sizes.

## Admin template editor

The admin Files tab for server templates is a separate webpack entry (`template-editor`, about 140 KB uncompressed, includes
React). It is only loaded on the template editor page; the Monaco chunk it shares with the file workspace is fetched when the
Files tab is first shown. Neither is referenced by the panel's main bundle, so the dashboard, account and login pages are unaffected.
