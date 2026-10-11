#!/usr/bin/env python3
"""Build SVG stage charts and a Markdown leaderboard from lifecycle.py output.

    report.py --out DOCS_DIR  LABEL_PREFIX=DIR [LABEL_PREFIX=DIR ...]   (e.g. baseline=out/baseline after=out/after)

Every number comes from the recorded runs (median of measured cycles). Charts split a start into the stages the harness
actually timestamps: command -> container started -> Paper "Starting" line -> Paper "Done" -> protocol-ready.
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import summarize  # noqa: E402

STAGES = [("to container start", "#2563eb"), ("JVM + Paperclip", "#d97706"), ("Paper init", "#16a34a"),
          ("Done -> protocol ready", "#9333ea")]


def parts(m):
    g = lambda k: m.get(k, {}).get("median")
    s, p, d, r = g("docker_start_ms"), g("paper_starting_ms"), g("paper_done_ms"), g("ready_ms")
    if None in (s, p, d, r):
        return None
    return [s, p - s, d - p, r - d]


def chart(rows, title, path):
    w, lh, left = 900, 34, 230
    scale = (w - left - 90) / max(sum(p) for _, p in rows)
    h = 70 + lh * len(rows) + 20 * len(STAGES) // 2
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="system-ui,sans-serif" font-size="13">',
         f'<rect width="{w}" height="{h}" fill="#fff"/>', f'<text x="12" y="24" font-size="15" font-weight="600">{title}</text>']
    for i, (label, p) in enumerate(rows):
        y = 44 + i * lh
        o.append(f'<text x="12" y="{y + 15}">{label}</text>')
        x = left
        for (name, col), v in zip(STAGES, p):
            o.append(f'<rect x="{x:.1f}" y="{y}" width="{v * scale:.1f}" height="22" fill="{col}"><title>{name}: {v:.0f} ms</title></rect>')
            x += v * scale
        o.append(f'<text x="{x + 6:.1f}" y="{y + 16}">{sum(p) / 1000:.2f} s</text>')
    ly = 54 + lh * len(rows)
    for i, (name, col) in enumerate(STAGES):
        o.append(f'<rect x="{12 + (i % 2) * 300}" y="{ly + (i // 2) * 20}" width="12" height="12" fill="{col}"/>'
                 f'<text x="{30 + (i % 2) * 300}" y="{ly + 11 + (i // 2) * 20}">{name}</text>')
    o.append("</svg>")
    Path(path).write_text("\n".join(o), encoding="utf-8")


def main():
    a = sys.argv[1:]
    out = Path(a[a.index("--out") + 1])
    src = [x.split("=", 1) for x in a if "=" in x]
    (out / "charts").mkdir(parents=True, exist_ok=True)
    all_s = {}
    for prefix, d in src:
        for label, v in summarize.summarize(d).items():
            all_s[f"{prefix}:{label}"] = v
    md = []
    for scen in ("start-warm", "start-cold", "restart-warm", "restart-cold"):
        rows = []
        for k in sorted(all_s):
            if k.split(":", 1)[1].endswith(scen):
                p = parts(all_s[k]["metrics"])
                if p:
                    rows.append((k, p))
        if rows:
            chart(rows, f"{scen}: median stage timings (ms), n=" + "/".join(str(all_s[k]["n"]) for k, _ in rows),
                  out / "charts" / f"{scen}.svg")
            md.append(f"![{scen}](charts/{scen}.svg)\n")
    (out / "wings-performance.json").write_text(json.dumps(all_s, indent=1), encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
