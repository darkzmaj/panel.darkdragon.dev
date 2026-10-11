#!/usr/bin/env python3
"""Build a startup-variant template of a Paperclip-based server (Paper / Canvas / DivineMC), Linux, root.

    mkvariant.py BASE_TEMPLATE NEW_TEMPLATE --image IMG [--flags "..."] [--aot | --cds | --bypass | --paperclip]
                 [--mem-mb 2355] [--strict] [--verify]

Writes NEW_TEMPLATE/jvm.args (a Java @argfile) so that the egg startup command becomes
    java @/home/container/jvm.args
Variants (exactly one):
- --paperclip: keep `-jar server.jar` (control, "default" startup).
- --bypass:    Paperclip is bypassed (libraries from META-INF/libraries.list + the patched server jar on the class path,
               real main class called) but NO class-data archive. This isolates what bypassing Paperclip alone saves, so an
               --aot result is not credited with the work Paperclip skipping already did.
- --aot (JDK 25, JEP 514) / --cds (JDK 21 dynamic AppCDS): bypass + one training boot that writes the archive.
Equivalence guarantees (checked by verify_equiv.py):
- the training boot runs in a SCRATCH copy (NEW_TEMPLATE.train) so it can never alter the world, logs, configs or plugin data
  of the measured template; the measured template is a clean copy of BASE plus jvm.args plus the archive file;
- the training container uses the production container shape and memory limit (containers.run_args, --mem-mb), because the
  JVM sizes its heap from the cgroup limit and an archive made under a different heap/GC shape may be rejected;
- all variants of one server get the same --flags and the same BASE files.
--strict adds -XX:AOTMode=on (-Xshare:on for --cds) to jvm.args: the JVM then refuses to start when the archive is unusable
instead of silently falling back to a normal (slow) boot, so a benchmark can never measure a fallback by accident.
--verify boots the final template once with that strict flag in a throwaway container and fails if it does not become ready.
"""
import argparse, os, shutil, subprocess, sys, time, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import containers  # noqa: E402
import probe  # noqa: E402

DEFAULT_FLAGS = "-Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true"
ARCHIVE = {"aot": ("app.aot", "-XX:AOTCacheOutput={p}", "-XX:AOTCache={p}", "-XX:AOTMode=on"),
           "cds": ("app.jsa", "-XX:ArchiveClassesAtExit={p}", "-XX:SharedArchiveFile={p}", "-Xshare:on")}


def parse(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("new")
    ap.add_argument("--image", required=True)
    ap.add_argument("--flags", default=DEFAULT_FLAGS)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--aot", action="store_true")
    g.add_argument("--cds", action="store_true")
    g.add_argument("--bypass", action="store_true")
    g.add_argument("--paperclip", action="store_true")
    ap.add_argument("--port", type=int, default=25598)
    ap.add_argument("--mem-mb", type=int, default=2355, help="training/verify container memory (2355 = the 2469606195 B lifecycle.py gives direct and Wings servers)")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--train-login", action="store_true", help="let one offline-mode player log in during the training boot, then leave")
    return ap.parse_args(argv)


def kind(A):
    return "aot" if A.aot else "cds" if A.cds else "bypass" if A.bypass else "paperclip" if A.paperclip else "bypass"


def classpath(jar):
    """(class path, main class) of the Paperclip bypass. The patched server jar must come first: it carries patched copies of
    some library classes (e.g. LogUtils)."""
    with zipfile.ZipFile(jar) as z:
        libs = [l.split("\t")[2] for l in z.read("META-INF/libraries.list").decode().splitlines() if l.strip()]
        ver = z.read("META-INF/versions.list").decode().split("\t")[2].strip()
        main = z.read("META-INF/main-class").decode().strip()
    for p in [ver] + libs:  # the lists come from the jar: never let them climb out of the server directory
        if p.startswith("/") or ".." in Path(p).parts:
            raise ValueError(f"suspicious path in Paperclip metadata: {p!r}")
    return ":".join([f"versions/{ver}"] + [f"libraries/{p}" for p in libs]), main


def jvm_lines(flags, extra, kind_, cp=None, main=None):
    lines = flags.split() + list(extra)
    if kind_ == "paperclip":
        lines += ["-jar", "server.jar", "nogui"]
    else:
        lines += ["--enable-native-access=ALL-UNNAMED", "-cp", cp, main, "nogui"]
    return lines


# ---- Docker seams (patched in tests) -----------------------------------------------------------------------------------
def start_container(name, root, A):
    subprocess.run(containers.run_args(name, A.port, root, A.image, A.mem_mb, ["java", "@/home/container/jvm.args"]),
                   check=True, capture_output=True)


def stop_container(name, grace=90):
    subprocess.run(["docker", "stop", "-t", str(grace), name], capture_output=True)
    out = subprocess.run(["docker", "logs", "--tail", "5", name], capture_output=True, text=True)
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    return out.stdout[-300:] + out.stderr[-300:]


def wait_ready(A):
    return probe.wait("127.0.0.1", A.port, timeout=300).get("status_ns")


def run_once(root, A, name, login=False):
    start_container(name, root, A)
    try:
        assert wait_ready(A), "boot never became ready"
        if login:
            probe.login("127.0.0.1", A.port, name="trainer")
            time.sleep(3)
        time.sleep(2)
    finally:
        tail = stop_container(name)  # always remove the container; a failed boot must still raise below, not be swallowed
    return tail


def chown(path):
    subprocess.run(["chown", "-R", "988:988", str(path)], check=True)


def build(A):
    k = kind(A)
    base, new = Path(A.base), Path(A.new)
    if new.exists():
        shutil.rmtree(new)
    cp = main = None
    if k != "paperclip":
        cp, main = classpath(base / "server.jar")
    pid = os.getpid()
    if k in ARCHIVE:
        fname, out_flag, use_flag, strict_flag = ARCHIVE[k]
        scratch = Path(f"{A.new}.train")
        if scratch.exists():
            shutil.rmtree(scratch)
        subprocess.run(["cp", "-a", str(base), str(scratch)], check=True)
        try:
            (scratch / "jvm.args").write_text("\n".join(jvm_lines(A.flags, [out_flag.format(p="/home/container/" + fname)], k, cp, main)) + "\n")
            chown(scratch)
            tail = run_once(scratch, A, f"mkvariant-train-{pid}", A.train_login)
            assert (scratch / fname).exists(), f"{fname} was not written; last log: {tail}"
            subprocess.run(["cp", "-a", str(base), str(new)], check=True)   # clean copy: training never touches what is measured
            shutil.copy2(scratch / fname, new / fname)
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
        extra = [use_flag.format(p="/home/container/" + fname)] + ([strict_flag] if A.strict else [])
    else:
        subprocess.run(["cp", "-a", str(base), str(new)], check=True)
        extra = []
    (new / "jvm.args").write_text("\n".join(jvm_lines(A.flags, extra, k, cp, main)) + "\n")
    chown(new)
    if A.verify:
        verify(A, new, k, cp, main, extra)
    arch = [new / v[0] for v in ARCHIVE.values() if (new / v[0]).exists()]
    print(new, "ok", k, arch[0].stat().st_size if arch else "")


def verify(A, new, k, cp, main, extra):
    """Boot the final template once with the strict flag. The strict argfile is written into a scratch copy of the
    jvm.args only (never into the template) and the throwaway container mounts a clean copy, so the template stays pristine."""
    chk = Path(f"{A.new}.verify")
    if chk.exists():
        shutil.rmtree(chk)
    subprocess.run(["cp", "-a", str(new), str(chk)], check=True)
    try:
        strict = [] if (k not in ARCHIVE or A.strict) else [ARCHIVE[k][3]]
        (chk / "jvm.args").write_text("\n".join(jvm_lines(A.flags, extra + strict, k, cp, main)) + "\n")
        chown(chk)
        run_once(chk, A, f"mkvariant-verify-{os.getpid()}")
    finally:
        shutil.rmtree(chk, ignore_errors=True)


if __name__ == "__main__":
    build(parse())
