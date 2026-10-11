# Wings compatibility

## What "Gobia Panel 2.0" is, in the sources

`VERSION` of this repository is `1.15.1-gobia.1`: the Gobia Panel is a fork of **Pterodactyl Panel 1.x** (v1.15.1 base).
There is no upstream "Pterodactyl 2.0" Panel in the sources read. Wings, however, has started a "v2" line: upstream `develop`
(Oct 2026) carries a v2 announcement and 108 files / ~4,900 lines of changes since `v1.13.3` ("Improve server and container
lifecycle handling", HTTP/websocket, SFTP, filesystem rewrites), with no release tag yet.

## Versions and evidence

| Wings build | Verified with | Evidence |
|---|---|---|
| **v1.13.3** (`ghcr.io/pterodactyl/wings@sha256:97937976…`) | stock Panel `240aaf62e` **and** Gobia Panel `ac2dfa1aa` | the benchmark session's frozen baselines ran it against both (192 k6 runs, plus byte-transfer, backup and websocket baselines; the only failures reported were the listing race fixed here) |
| upstream `develop` @ `cba8315` (unmodified, image `wings-dev:base`) | stock Panel `240aaf62e` (`wdev` stack) | ~190 start/stop/restart cycles driven through the Wings power API worked; the node config, server config sync and server creation came from the Panel. Console/websocket and SFTP were not exercised |
| Gobia fork (`gobia/perf`, `wings-dev:p2`) | stock Panel `240aaf62e` (`wdev` stack) | the same plus `bench/wings/validate.py` (7 checks pass) |

**Not done:** the develop-based builds were *not* run against the Gobia Panel image. The stock Panel image is the same
`/api/remote` contract the Gobia fork inherits (Gobia changes are UI/extension level), but that is an inference. Before
any rollout: run `wdev` with `WDEV_PANEL_IMAGE=bench-gobia:ac2dfa1` (the provisioning script has Gobia-specific steps keyed
on the stack name, so it needs adapting) and repeat `validate.py`.

## Recommendation on the exact version

Use **v1.13.3 as the production baseline** (the only release verified against the Gobia Panel). The patches are small and
mostly independent of the lifecycle rewrite: port `imageCurrent` (image pull policy) and the `ReadDirMap` fix onto v1.13.3
or onto the first tagged v2 release rather than shipping an untagged `develop` build. They were measured on `develop`;
porting needs a re-measurement (the unmodified `develop` start is 213 ms slower than v1.13.3, and `develop` reports `offline`
~240 ms later than v1.13.3 does).

## Behaviour preserved / changed

Container security options, resource limits, mounts, network, user, capabilities, pids limit and log config are produced by
the unchanged upstream code (`containerSpec` is the former body of `Create()` moved verbatim). New: one label
(`gobia.spec`) on containers; two optional `docker:` config keys; reuse is off and the pull policy is `always` unless set,
in which case the fork behaves like upstream. Mutable image tags are refreshed at most hourly under `periodic`; a
security-patched image is therefore picked up within the refresh interval instead of at the next start.
