# Wings compatibility

| Question | Answer |
|---|---|
| Panel | `1.15.1-gobia.1` (Pterodactyl 1.x base) |
| Upstream Wings read | `develop` @ `cba8315bceda926241d6f86e78b3bd52cf15e41f`; latest release `v1.13.3` |
| Is `v1.13.3` compatible with this Panel's remote API? | **Unverified.** The Panel changelog says transfers need Wings v1.11.x; nothing newer was checked against the Panel's `/api/remote` routes or the Wings `remote` client |
| Gobia fork | Not created; no Wings code modified; production Wings untouched |
| Security/isolation | No change to Docker flags, limits, TLS or auth |

Before any fork: diff Wings `remote/` request/response types against the Panel's `/api/remote` controllers and run
stock Wings against a staging Panel.
