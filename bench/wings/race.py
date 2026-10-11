#!/usr/bin/env python3
"""Reproduce the reported HTTP 500 on concurrent file operations by talking to Wings directly (no Panel involved).

    race.py --uuid UUID [--writers 8] [--listers 4] [--seconds 15]

Writers create / rename / delete files in one directory while listers call files/list-directory on it. Prints the
status-code histogram of the listings and of the writes; on stock Wings the listings return 500
("lstatat <name>: file does not exist"), proving the fault is in Wings' directory listing, not in the Panel.
"""
import argparse, collections, http.client, json, threading, time
from pathlib import Path
from urllib.parse import quote

ap = argparse.ArgumentParser()
ap.add_argument("--uuid", required=True)
ap.add_argument("--url", default="127.0.0.1:19090")
ap.add_argument("--token-file", default="/bench/wings-opt/wdev-token")
ap.add_argument("--writers", type=int, default=8)
ap.add_argument("--listers", type=int, default=4)
ap.add_argument("--seconds", type=float, default=15)
A = ap.parse_args()
TOKEN = Path(A.token_file).read_text().strip()
H = {"Authorization": f"Bearer {TOKEN}"}
lock = threading.Lock()
lists, writes, msgs = collections.Counter(), collections.Counter(), collections.Counter()
end = time.time() + A.seconds


def req(c, method, path, body=None):
    c.request(method, path, body, H)
    r = c.getresponse()
    return r.status, r.read()


def writer(i):
    c = http.client.HTTPConnection(A.url, timeout=30)
    n = 0
    while time.time() < end:
        n += 1
        a, b = f"/race/w{i}-{n}.txt", f"/race/w{i}-{n}.renamed"
        for m, p, body in (("POST", f"/api/servers/{A.uuid}/files/write?file={quote(a)}", b"x"),
                           ("PUT", f"/api/servers/{A.uuid}/files/rename", json.dumps(
                               {"root": "/", "files": [{"from": a[1:], "to": b[1:]}]}).encode()),
                           ("POST", f"/api/servers/{A.uuid}/files/delete", json.dumps(
                               {"root": "/", "files": [b[1:]]}).encode())):
            s, _ = req(c, m, p, body)
            with lock:
                writes[s] += 1


def lister():
    c = http.client.HTTPConnection(A.url, timeout=30)
    while time.time() < end:
        s, b = req(c, "GET", f"/api/servers/{A.uuid}/files/list-directory?directory=/race")
        with lock:
            lists[s] += 1
            if s != 200:
                msgs[b[:60].decode(errors="replace")] += 1


c = http.client.HTTPConnection(A.url, timeout=30)
req(c, "POST", f"/api/servers/{A.uuid}/files/create-directory", json.dumps({"name": "race", "path": "/"}).encode())
ts = [threading.Thread(target=writer, args=(i,)) for i in range(A.writers)] + [threading.Thread(target=lister) for _ in range(A.listers)]
[t.start() for t in ts]
[t.join() for t in ts]
print(json.dumps({"listings": dict(lists), "writes": dict(writes), "errors": dict(msgs)}, indent=1))
