#!/usr/bin/env python3
"""Local benchmark dashboard. Read-only: no write endpoints, no Docker control, 127.0.0.1 only, random access token.

    dashboard.py OUT_ROOT [--port 8765]

OUT_ROOT is searched recursively for the runs.jsonl / timeline.jsonl files lifecycle.py writes. Every 500 ms the page
receives (SSE) the aggregated results, the live stage events of the newest run (milliseconds since its T0, straight from
the recorded Docker/Wings/probe events), host load/memory and the names of running containers (`docker ps`, read-only).
/export returns the same data as JSON. Reach it from Windows through the WSL localhost forward.
"""
import hmac, json, secrets, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent))
import summarize  # noqa: E402

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else Path(".")
TOKEN = secrets.token_urlsafe(16)
_dock = {"t": 0, "v": []}

PAGE = r"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Wings bench</title>
<style>:root{--bg:#fff;--fg:#111;--mut:#666;--line:#ddd;--a:#2563eb;--b:#d97706}
@media(prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#999;--line:#333;--a:#60a5fa;--b:#fbbf24}}
body{font:14px system-ui;margin:0;padding:1rem 1.25rem;background:var(--bg);color:var(--fg)}h1{font-size:1.2rem}h2{font-size:1rem;margin:1.2rem 0 .4rem}
table{border-collapse:collapse}td,th{padding:.15rem .7rem;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
td:first-child,th:first-child{text-align:left}.mut{color:var(--mut)}.row{display:flex;gap:2rem;flex-wrap:wrap}.ev{font:12px ui-monospace,monospace}
.bar{height:10px;background:var(--a);display:inline-block}.bar.b{background:var(--b)}</style>
<h1>Wings startup bench <span class=mut id=s></span></h1>
<div class=row><div><h2>Live (newest run)</h2><div id=live class=ev></div></div>
<div><h2>Host</h2><div id=host class=ev></div></div></div>
<h2>Results (measured runs, ms)</h2><div id=res style="overflow-x:auto"></div>
<script>
const t=new URLSearchParams(location.search).get('t');
const es=new EventSource('/stream?t='+encodeURIComponent(t));
const K=['api_return_ms','docker_destroy_ms','docker_create_ms','docker_start_ms','paper_starting_ms','paper_done_ms','ready_ms','stop_exit_ms'];
es.onmessage=e=>{const d=JSON.parse(e.data);
 s.textContent=new Date().toLocaleTimeString()+' - export: /export?t='+t;
 host.innerHTML='load '+d.host.load+'<br>mem avail '+d.host.mem_mb+' MB<br>containers: '+(d.containers.join(', ')||'none');
 live.innerHTML=d.live.length?'<b>'+d.live[0].run+'</b><br>'+d.live.map(x=>(x.ms.toFixed(1)).padStart(9)+' ms  '+x.stage).join('<br>'):'<span class=mut>no runs yet</span>';
 const labels=Object.keys(d.summary).sort();
 const max=Math.max(1,...labels.map(l=>(d.summary[l].metrics.ready_ms||{median:0}).median));
 res.innerHTML='<table><tr><th>label<th>n'+K.map(k=>'<th>'+k.replace('_ms','')).join('')+'<th>ready p95<th></tr>'+labels.map(l=>{const m=d.summary[l].metrics;
  return '<tr><td>'+l+'<td>'+d.summary[l].n+K.map(k=>'<td>'+(m[k]?m[k].median:'')).join('')+'<td>'+(m.ready_ms?m.ready_ms.p95:'')+
  '<td><span class=bar style="width:'+(120*(m.ready_ms?m.ready_ms.median:0)/max)+'px"></span>'}).join('')+'</table>';
};
es.onerror=()=>s.textContent=' - stream lost (bad token?)';
</script>"""


def containers():
    if time.time() - _dock["t"] > 2:
        try:
            _dock["v"] = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True,
                                        timeout=3).stdout.split()
        except Exception:
            _dock["v"] = []
        _dock["t"] = time.time()
    return _dock["v"]


def live():
    best, rows = 0, []
    for f in ROOT.rglob("timeline.jsonl"):
        try:
            lines = f.read_text().splitlines()[-400:]
        except OSError:
            continue
        rs = [json.loads(x) for x in lines if x.strip()]
        if rs and rs[-1]["ns"] > best:
            best, rows = rs[-1]["ns"], rs
    if not rows:
        return []
    run = rows[-1]["run"]
    ev = [r for r in rows if r["run"] == run]
    t0 = next((r["ns"] for r in ev if r["stage"] == "T0"), ev[0]["ns"])
    return [{"run": run, "stage": r["stage"], "ms": (r["ns"] - t0) / 1e6} for r in ev][-40:]


def snapshot():
    dirs = sorted({str(p.parent) for p in ROOT.rglob("runs.jsonl")})
    try:
        mem = [int(x.split()[1]) // 1024 for x in open("/proc/meminfo") if x.startswith("MemAvailable")][0]
        load = open("/proc/loadavg").read().split()[0]
    except OSError:
        mem, load = None, None
    return {"summary": summarize.summarize(*dirs) if dirs else {}, "live": live(), "containers": containers(),
            "host": {"load": load, "mem_mb": mem}}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if not hmac.compare_digest(parse_qs(u.query).get("t", [""])[0], TOKEN):
            return self.send(403, "text/plain", b"forbidden")
        if u.path == "/":
            self.send(200, "text/html", PAGE.encode())
        elif u.path == "/export":
            self.send(200, "application/json", json.dumps(snapshot(), indent=1).encode())
        elif u.path == "/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                while True:
                    self.wfile.write(b"data: " + json.dumps(snapshot()).encode() + b"\n\n")
                    self.wfile.flush()
                    time.sleep(0.5)
            except OSError:
                pass
        else:
            self.send(404, "text/plain", b"not found")


if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8765
    print(f"http://127.0.0.1:{port}/?t={TOKEN}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
