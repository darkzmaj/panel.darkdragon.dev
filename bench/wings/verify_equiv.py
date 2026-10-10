#!/usr/bin/env python3
"""Prove that benchmark variants run an equivalent workload before any timing is taken.

    verify_equiv.py TEMPLATE_DIR TEMPLATE_DIR [TEMPLATE_DIR ...] [--fast] [--json]

Exit status 0 only when, for every pair of templates of ONE server (e.g. canvas-j25-pc / -bypass / -aot):
  * every file other than the variant files (jvm.args, app.aot, app.jsa) exists in all of them with identical content
    (world, server.properties, plugins, configs, libraries, server.jar) -- sha256, or size with --fast;
  * the JVM flags that are not startup-variant flags (heap, GC, system properties) are identical.
Differences are printed one per line. Run it for canvas variants together and for divine variants together; comparing a
Canvas template with a DivineMC template is meaningless and is not attempted.
"""
import hashlib, json, sys
from pathlib import Path

VARIANT_FILES = {"jvm.args", "app.aot", "app.jsa"}
STOP_TOKENS = ("-jar", "-cp", "--enable-native-access=ALL-UNNAMED")


def manifest(root, fast=False):
    root = Path(root)
    out = {}
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.is_symlink():
            continue
        rel = p.relative_to(root).as_posix()
        if rel in VARIANT_FILES:
            continue
        if fast:
            out[rel] = p.stat().st_size
        else:
            h = hashlib.sha256()
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            out[rel] = h.hexdigest()
    return out


def jvm_signature(root):
    """The flags both variants must share: everything before the launch part, minus archive/CDS switches."""
    toks = Path(root, "jvm.args").read_text().split()
    sig = []
    for t in toks:
        if t in STOP_TOKENS:
            break
        if t.startswith(("-XX:AOT", "-Xshare", "-XX:SharedArchiveFile", "-XX:ArchiveClassesAtExit")):
            continue
        sig.append(t)
    return sig


def compare(roots, fast=False):
    diffs = []
    ref_root = roots[0]
    ref, ref_sig = manifest(ref_root, fast), jvm_signature(ref_root)
    for r in roots[1:]:
        m, sig = manifest(r, fast), jvm_signature(r)
        for k in sorted(set(ref) | set(m)):
            if k not in m:
                diffs.append(f"{r}: missing {k}")
            elif k not in ref:
                diffs.append(f"{r}: extra file {k}")
            elif ref[k] != m[k]:
                diffs.append(f"{r}: {k} differs from {ref_root}")
        if sig != ref_sig:
            diffs.append(f"{r}: JVM flags differ: {sig} vs {ref_sig}")
    return diffs


def main(argv):
    fast = "--fast" in argv
    as_json = "--json" in argv
    roots = [a for a in argv if not a.startswith("--")]
    if len(roots) < 2:
        sys.exit(__doc__)
    for r in roots:
        if not Path(r, "jvm.args").is_file():
            sys.exit(f"{r}: no jvm.args (not a variant template)")
    diffs = compare(roots, fast)
    if as_json:
        print(json.dumps({"templates": roots, "equivalent": not diffs, "differences": diffs}, indent=1))
    else:
        print("EQUIVALENT" if not diffs else "\n".join(["NOT EQUIVALENT"] + diffs))
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
