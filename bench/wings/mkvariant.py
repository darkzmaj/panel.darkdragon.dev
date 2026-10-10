#!/usr/bin/env python3
"""Build a startup-variant template of a Paperclip-based server (Paper / Canvas / DivineMC), Linux, root.

    mkvariant.py BASE_TEMPLATE NEW_TEMPLATE --image IMG [--flags "..."] [--aot | --cds] [--paperclip]

Writes NEW_TEMPLATE/jvm.args (a Java @argfile) so that the egg startup command becomes
    java @/home/container/jvm.args
- default: Paperclip is bypassed. Paperclip only verifies/patches libraries and then runs the server in a child
  classloader; the argfile instead puts exactly the libraries from META-INF/libraries.list plus the patched server jar
  on the application class path and calls the real main class. This is what makes class-data archives possible.
- --paperclip keeps `-jar server.jar` (control).
- --aot (JDK 24+): one training boot with -XX:AOTCacheOutput, stopped gracefully, then the argfile uses -XX:AOTCache.
- --cds: same with dynamic AppCDS (-XX:ArchiveClassesAtExit / -XX:SharedArchiveFile), works on JDK 21.
The training boot uses the same flags, mounts and uid as the real container and never contains a player session.
"""
import argparse, os, shutil, subprocess, sys, time, zipfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("base")
ap.add_argument("new")
ap.add_argument("--image", required=True)
ap.add_argument("--flags", default="-Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true")
ap.add_argument("--aot", action="store_true")
ap.add_argument("--cds", action="store_true")
ap.add_argument("--paperclip", action="store_true")
ap.add_argument("--port", type=int, default=25598)
ap.add_argument("--train-login", action="store_true", help="let one offline-mode player log in during the training boot, then leave")
A = ap.parse_args()
sys.path.insert(0, str(Path(__file__).parent))
import probe  # noqa: E402

new = Path(A.new)
if new.exists():
    shutil.rmtree(new)
subprocess.run(["cp", "-a", A.base, str(new)], check=True)
z = zipfile.ZipFile(new / "server.jar")
libs = [l.split("\t")[2] for l in z.read("META-INF/libraries.list").decode().splitlines() if l.strip()]
ver = z.read("META-INF/versions.list").decode().split("\t")[2].strip()
main = z.read("META-INF/main-class").decode().strip()
# the patched server jar must come first: it carries patched copies of some library classes (e.g. LogUtils)
cp = ":".join([f"versions/{ver}"] + [f"libraries/{p}" for p in libs])


def write(extra):
    lines = A.flags.split() + extra
    if A.paperclip:
        lines += ["-jar", "server.jar", "nogui"]
    else:
        lines += ["--enable-native-access=ALL-UNNAMED", "-cp", cp, main, "nogui"]
    (new / "jvm.args").write_text("\n".join(lines) + "\n")


def train(extra_out, name):
    write(extra_out)
    subprocess.run(["chown", "-R", "988:988", str(new)], check=True)
    cn = f"mkvariant-{os.getpid()}"
    subprocess.run(["docker", "run", "-d", "--name", cn, "--user", "988:988", "-p", f"127.0.0.1:{A.port}:25565",
                    "-v", f"{new}:/home/container", "-w", "/home/container", A.image, "java", "@/home/container/jvm.args"],
                   check=True, capture_output=True)
    try:
        r = probe.wait("127.0.0.1", A.port, timeout=300)
        assert r.get("status_ns"), "training boot never became ready"
        if A.train_login:
            probe.login("127.0.0.1", A.port, name="trainer")
            time.sleep(3)
        time.sleep(2)
    finally:
        subprocess.run(["docker", "stop", "-t", "90", cn], capture_output=True)
        out = subprocess.run(["docker", "logs", "--tail", "5", cn], capture_output=True, text=True)
        subprocess.run(["docker", "rm", "-f", cn], capture_output=True)
    assert (new / name).exists(), f"{name} was not written; last log: {out.stdout[-300:]}{out.stderr[-300:]}"


if A.aot:
    train(["-XX:AOTCacheOutput=/home/container/app.aot"], "app.aot")
    write(["-XX:AOTCache=/home/container/app.aot"])
elif A.cds:
    train(["-XX:ArchiveClassesAtExit=/home/container/app.jsa"], "app.jsa")
    write(["-XX:SharedArchiveFile=/home/container/app.jsa"])
else:
    write([])
subprocess.run(["chown", "-R", "988:988", str(new)], check=True)
print(new, "ok", (new / "app.aot").stat().st_size if (new / "app.aot").exists() else (new / "app.jsa").stat().st_size if (new / "app.jsa").exists() else "")
