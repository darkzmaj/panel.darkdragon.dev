# Wings final results

**There are no results.** The leaderboard cannot be filled without a Linux/Docker host. Every cell is "not measured";
no percentage improvement, winner or "faster than stock" claim is made.

| Metric | Direct Docker | Stock Wings | Gobia Wings |
|---|---|---|---|
| API/command overhead | N/A | not measured | not implemented |
| Docker startup overhead | not measured | not measured | not implemented |
| Java startup | not measured | not measured | not implemented |
| Paper ready (T10) | not measured | not measured | not implemented |
| Player join ready | not implemented | not implemented | not implemented |
| Graceful restart | not measured | not measured | not implemented |
| Warm server activation | not implemented | not implemented | not implemented |
| RAM / CPU overhead | not measured | not measured | not implemented |

Final-report items 1-25 (hardware, medians/P95, optimizations, security, reliability, replace-stock recommendation) are
all blocked on a host. Recommendation today: **do not replace stock Wings**; nothing has been built or proven. Next step
is the baseline run in `wings-startup-baseline.md`, then the candidates in `wings-optimizations.md`.
