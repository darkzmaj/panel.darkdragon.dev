#!/usr/bin/env python3
"""Minecraft readiness probe: TCP listener (T9) and protocol-level status ping (T10).

    probe.py wait HOST PORT [--timeout 120] [--interval 0.005]
    probe.py selftest

`wait` polls until the first TCP connect and the first valid Server List Ping answer, then prints one JSON line with
wall-clock nanosecond timestamps (time.time_ns, comparable with `date +%s%N` and Docker's timeNano on the same host).
A status answer counts only if it parses as JSON with a `version` object: an open socket is not "ready".
"""
import json, socket, struct, sys, threading, time


def varint(n):
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def read_varint(sock):
    n = shift = 0
    while True:
        b = sock.recv(1)
        if not b:
            raise EOFError
        n |= (b[0] & 0x7F) << shift
        if not b[0] & 0x80:
            return n
        shift += 7
        if shift > 35:
            raise ValueError("varint too long")


def packet(pid, payload=b""):
    body = varint(pid) + payload
    return varint(len(body)) + body


def read_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf


def status(host, port, timeout=1.0, proto=767):
    """Handshake -> status request -> parsed status JSON. Raises on any failure."""
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.settimeout(timeout)
        h = host.encode()
        s.sendall(packet(0x00, varint(proto) + varint(len(h)) + h + struct.pack(">H", port) + varint(1)))
        s.sendall(packet(0x00))
        length = read_varint(s)
        data = read_exact(s, length)
        # data = varint packet id, varint string length, string
        i = 0
        while data[i] & 0x80:
            i += 1
        i += 1
        j = i
        while data[j] & 0x80:
            j += 1
        slen = 0
        for k, b in enumerate(data[i:j + 1]):
            slen |= (b & 0x7F) << (7 * k)
        doc = json.loads(data[j + 1:j + 1 + slen].decode())
        if not isinstance(doc.get("version"), dict):
            raise ValueError("status reply has no version")
        return doc


def login(host, port, name="bench", proto=774, timeout=5.0):
    """Offline-mode login up to Login Success (what 'a player can join' means before the configuration phase).

    Returns seconds from first connect to Login Success. Raises if the server disconnects the player or answers badly.
    Needs online-mode=false. Handles the optional Set Compression packet."""
    import uuid, zlib
    t0 = time.perf_counter()
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.settimeout(timeout)
        h = host.encode()
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        nb = name.encode()  # a real client sends both packets back to back; one write avoids a Nagle/delayed-ACK stall
        s.sendall(packet(0x00, varint(proto) + varint(len(h)) + h + struct.pack(">H", port) + varint(2)) +
                  packet(0x00, varint(len(nb)) + nb + uuid.uuid3(uuid.NAMESPACE_DNS, "OfflinePlayer:" + name).bytes))
        compressed = False
        while True:
            body = read_exact(s, read_varint(s))
            if compressed:  # leading data-length varint; 0 means the rest is not compressed
                n = i = 0
                while True:
                    b = body[i]
                    n |= (b & 0x7F) << (7 * i)
                    i += 1
                    if not b & 0x80:
                        break
                body = zlib.decompress(body[i:]) if n else body[i:]
            if body[0] == 0x03:
                compressed = True
            elif body[0] == 0x02:
                return time.perf_counter() - t0
            else:
                raise ValueError(f"login refused or unexpected packet 0x{body[0]:02x}: {body[1:200]!r}")


def wait(host, port, timeout=120.0, interval=0.005):
    t0 = time.time_ns()
    tcp = None
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            if tcp is None:
                socket.create_connection((host, port), timeout=0.25).close()
                tcp = time.time_ns()
            doc = status(host, port)
            return {"probe_start_ns": t0, "tcp_ns": tcp, "status_ns": time.time_ns(),
                    "version": doc["version"].get("name"), "players_max": doc.get("players", {}).get("max")}
        except (OSError, EOFError, ValueError, json.JSONDecodeError, IndexError):
            time.sleep(interval)
    return {"probe_start_ns": t0, "tcp_ns": tcp, "status_ns": None, "error": "timeout"}


def selftest():
    """Parser check against an in-process fake server. Proves the probe's framing, NOT any Minecraft timing."""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(4)
    port = srv.getsockname()[1]

    def serve():
        while True:  # wait() makes a bare TCP connect first, then the real status exchange
            c, _addr = srv.accept()
            try:
                c.settimeout(0.5)
                if not c.recv(4096):
                    continue
                body = json.dumps({"version": {"name": "fake", "protocol": 767}, "players": {"max": 20}}).encode()
                c.sendall(packet(0x00, varint(len(body)) + body))
            except OSError:
                pass
            finally:
                c.close()

    threading.Thread(target=serve, daemon=True).start()
    r = wait("127.0.0.1", port, timeout=5)
    assert r["status_ns"] and r["tcp_ns"] and r["version"] == "fake", r
    assert r["status_ns"] >= r["tcp_ns"] >= r["probe_start_ns"]
    print("selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["selftest"]:
        selftest()
    elif a[:1] == ["wait"] and len(a) >= 3:
        kw = dict(zip(a[3::2], a[4::2]))
        print(json.dumps(wait(a[1], int(a[2]), float(kw.get("--timeout", 120)), float(kw.get("--interval", 0.005)))))
    else:
        sys.exit(__doc__)
