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


MAX_FRAME = 1 << 21  # a status/login/config frame is never this large; refuse to wait for garbage lengths


def read_exact(sock, n):
    if n < 0 or n > MAX_FRAME:
        raise ValueError(f"implausible frame length {n}")
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


def _frames(s, state):
    """Yield (packet_id, payload) from a socket, handling the optional compression set by Set Compression."""
    import zlib

    def gen():
        while True:
            body = read_exact(s, read_varint(s))
            if state["compressed"]:
                n = i = 0
                while True:
                    b = body[i]
                    n |= (b & 0x7F) << (7 * i)
                    i += 1
                    if not b & 0x80:
                        break
                body = zlib.decompress(body[i:]) if n else body[i:]
            i = 0
            pid = 0
            shift = 0
            while True:
                b = body[i]
                pid |= (b & 0x7F) << shift
                i += 1
                shift += 7
                if not b & 0x80:
                    break
            yield pid, body[i:]
    return gen()


def _send(s, state, pid, payload=b""):
    body = varint(pid) + payload
    if state["compressed"]:
        body = varint(0) + body  # below the threshold: data length 0 = not compressed (the server's threshold is >= 256)
    s.sendall(varint(len(body)) + body)


def join(host, port, name="bench", proto=774, timeout=15.0, vhost=None):
    """Offline-mode join as far as the PLAY state: login, configuration, then the first Play packet (Paper sends
    the join-game packet first). Returns seconds from connect for each step. A real client does more after this
    (chunks), so "joined" here means: the server accepted the player, completed configuration and entered Play.
    Packet ids are those of 1.21.9+ (protocol 773/774) for the configuration state."""
    import uuid
    t0 = time.perf_counter()
    deadline = t0 + timeout  # `timeout` is also the TOTAL budget: a trickling server cannot extend it packet by packet
    r = {}
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.settimeout(timeout)
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        st = {"compressed": False}
        h = (vhost or host).encode()
        nb = name.encode()
        s.sendall(packet(0x00, varint(proto) + varint(len(h)) + h + struct.pack(">H", port) + varint(2)) +
                  packet(0x00, varint(len(nb)) + nb + uuid.uuid3(uuid.NAMESPACE_DNS, "OfflinePlayer:" + name).bytes))
        it = _frames(s, st)
        state = "login"
        while True:
            pid, p = next(it)
            now = time.perf_counter() - t0
            if time.perf_counter() > deadline:
                raise TimeoutError(f"join exceeded {timeout}s")
            if state == "login":
                if pid == 0x03:
                    st["compressed"] = True
                elif pid == 0x02:
                    r["login_success"] = now
                    _send(s, st, 0x03)  # Login Acknowledged
                    state = "config"
                    # Client Information
                    loc = b"en_us"
                    _send(s, st, 0x00, varint(len(loc)) + loc + b"\x08" + varint(0) + b"\x01" + b"\x7f" + varint(1) + b"\x00" + b"\x01" + varint(0))
                else:
                    raise ValueError(f"login refused or unexpected packet 0x{pid:02x}: {p[:120]!r}")
            elif state == "config":
                if pid == 0x03:  # Finish Configuration
                    r["config_done"] = now
                    _send(s, st, 0x03)
                    state = "play"
                elif pid == 0x0E:  # Clientbound Known Packs: a vanilla client owns the core pack, so echo the list back
                    _send(s, st, 0x07, p)  # (the server then skips the bulky registry data a pack-less client would need)
                elif pid == 0x04:  # Keep Alive
                    _send(s, st, 0x04, p[:8])
                elif pid == 0x05:  # Ping
                    _send(s, st, 0x05, p[:4])
                elif pid == 0x02:
                    raise ValueError(f"disconnected during configuration: {p[:120]!r}")
            else:
                r["play_first_packet"] = now
                return r


def wait(host, port, timeout=120.0, interval=0.005, cancel=None):
    """`cancel`: optional threading.Event; when set, wait returns promptly with error=cancelled."""
    t0 = time.time_ns()
    tcp = None
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cancel is not None and cancel.is_set():
            return {"probe_start_ns": t0, "tcp_ns": tcp, "status_ns": None, "error": "cancelled"}
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
