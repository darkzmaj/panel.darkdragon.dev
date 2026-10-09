#!/usr/bin/env python3
"""Local benchmark dashboard. Read-only view of run.sh output directories; no Docker access, no write endpoints.

    dashboard.py OUT_ROOT [--port 8765]

Binds 127.0.0.1 only and requires the random token printed at start (?t=TOKEN). It streams a snapshot of
OUT_ROOT/*/run-*/ every 500 ms over SSE (stages are computed from the same artifacts summarize.py reads, so what is
shown is what was recorded) and offers /export as JSON. Remote use: `ssh -L 8765:127.0.0.1:8765 node`.
"""
import hmac, json, secrets, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent))
import summarize  # noqa: E402

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
TOKEN = secrets.token_urlsafe(16)

PAGE = """<!doctype html><meta charset=utf-8><title>Wings bench</title>
<style>body{font:14px system-ui;margin:1rem;background:#fff;color:#111}table{border-collapse:collapse}td,th{padding:.2rem .6rem;border-bottom:1px solid #ddd;text-align:right}
th:first-child,td:first-child{text-align:left}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#333}}</style>
<h1>Wings startup bench</h1><p id=s>connecting...</p><div id=o></div>
<script>
const t=new URLSearchParams(location.search).get('t');
const es=new EventSource('/stream?t='+encodeURIComponent(t));
es.onmessage=e=>{const d=JSON.parse(e.data);document.getElementById('s').textContent=
 new Date().toLocaleTimeString()+' - '+d.cases.length+' case(s); latest artifact: '+(d.latest||'none')+' - export: /export?t='+t;
 document.getElementById('o').innerHTML=d.cases.map(c=>{const ks=Object.keys(c.stages);
 return '<h3>'+c.name+' (n='+c.n+')</h3><table><tr><th>stage ms<th>n<th>min<th>median<th>p95<th>max</tr>'+
 ks.map(k=>{const s=c.stages[k];return '<tr><td>'+k+'<td>'+s.n+'<td>'+s.min+'<td>'+s.median+'<td>'+s.p95+'<td>'+s.max}).join('')+'</table>'+
 '<p>last run: '+JSON.stringify(c.runs[c.runs.length-1]||{})+'</p>'}).join('')};
es.onerror=()=>document.getElementById('s').textContent='stream lost (bad token?)';
</script>"""


def snapshot():
    cases, latest = [], 0
    for d in sorted(p for p in ROOT.iterdir() if (p / "env.json").exists() or any(p.glob("run-*"))):
        s = summarize.summarize(d)
        cases.append({"name": d.name, "n": s["n"], "stages": s["stages"], "runs": s["runs"], "env": s["env"]})
        for f in d.glob("run-*/*"):
            latest = max(latest, f.stat().st_mtime)
    return {"cases": cases, "latest": time.strftime("%H:%M:%S", time.localtime(latest)) if latest else None}


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
        tok = parse_qs(u.query).get("t", [""])[0]
        if not hmac.compare_digest(tok, TOKEN):
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
