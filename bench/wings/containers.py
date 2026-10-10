"""Container flags shared by the pool and concurrency benchmarks. Pure functions, no I/O, unit-tested.

The security shape mirrors what Wings builds for a game server (non-root uid, read-only rootfs, no-new-privileges,
pids/memory limits) and is stricter where Wings has to stay compatible with arbitrary eggs (all capabilities dropped).
Ports are published on loopback only: a benchmark instance must never be reachable from the network.
"""
import re

SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$")
UID_GID = "988:988"


def check_name(name):
    if not SAFE_NAME.match(name):
        raise ValueError(f"unsafe container name {name!r}")
    return name


def check_overlay_path(p):
    """overlayfs option strings are comma separated and use ':' between lower dirs: such paths cannot be passed safely."""
    p = str(p)
    if any(c in p for c in ",:\n\0"):
        raise ValueError(f"path {p!r} cannot be used in an overlayfs mount option")
    return p


def run_args(name, port, root, image, mem_mb, cmd, tmp_mb=100):
    """`docker run -d` argv for one Minecraft instance. `cmd` is a list (never a shell string)."""
    check_name(name)
    if not isinstance(cmd, (list, tuple)) or not cmd:
        raise ValueError("cmd must be a non-empty argv list")
    if not 1 <= int(port) <= 65535:
        raise ValueError("bad port")
    if int(mem_mb) < 256:
        raise ValueError("mem_mb must be >= 256")
    mem = f"{int(mem_mb)}m"
    return ["docker", "run", "-d", "--name", name, "--user", UID_GID, "--read-only",
            "--tmpfs", f"/tmp:rw,exec,nosuid,size={int(tmp_mb)}M", "--security-opt", "no-new-privileges",
            "--cap-drop", "ALL", "--memory", mem, "--memory-swap", mem, "--pids-limit", "512",
            "-p", f"127.0.0.1:{int(port)}:25565", "-v", f"{root}:/home/container", "-w", "/home/container",
            "-e", "TZ=UTC", image, *cmd]
