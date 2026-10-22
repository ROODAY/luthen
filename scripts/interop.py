#!/usr/bin/env python3
"""Interop test: shares and ciphertext produced by `luthen seal` must be
recoverable with the reference `shamir` (shamir-mnemonic) and `age` CLIs.

Usage: python scripts/interop.py "<luthen-cmd>"     e.g. "bun src/cli/main.ts"
Needs: pexpect, `shamir` and `age` on PATH.
"""
import os
import re
import shlex
import subprocess
import sys
import tempfile

import pexpect

TIMEOUT = 120
SHARE_PROMPT = "Enter a recovery share: "
PASSPHRASE_PROMPT = "Enter passphrase: "


def fail(msg):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def read_words(bundle_dir):
    """Canonical word list of a share: indices block mapped through the bundled wordlist."""
    with open(os.path.join(bundle_dir, "share.txt"), encoding="utf-8") as f:
        text = f.read()
    m = re.search(
        r"-----BEGIN SLIP-39 WORD INDICES-----\n(.*?)\n-----END SLIP-39 WORD INDICES-----",
        text,
        re.S,
    )
    if not m:
        fail(f"no word indices block in {bundle_dir}/share.txt")
    with open(os.path.join(bundle_dir, "slip39-wordlist.txt"), encoding="utf-8") as f:
        wordlist = f.read().split()
    return " ".join(wordlist[int(i)] for i in m.group(1).split())


def shamir_recover(mnemonics):
    child = pexpect.spawn("shamir", ["recover"], encoding="utf-8", timeout=TIMEOUT)
    for words in mnemonics:
        child.expect_exact(SHARE_PROMPT)
        child.sendline(words)
    child.expect(r"Your master secret is: ([0-9a-f]{64})")
    secret = child.match.group(1)
    child.expect(pexpect.EOF)
    child.close()
    if child.exitstatus != 0:
        fail(f"shamir recover exited {child.exitstatus}")
    return secret


def age_decrypt(ciphertext, out_path, passphrase):
    child = pexpect.spawn("age", ["-d", "-o", out_path, ciphertext], encoding="utf-8", timeout=TIMEOUT)
    child.expect_exact(PASSPHRASE_PROMPT)
    child.sendline(passphrase)
    child.expect(pexpect.EOF)
    child.close()
    if child.exitstatus != 0:
        fail(f"age -d exited {child.exitstatus}: {child.before!r}")


def run_case(label, luthen_cmd, seal_args, holders, root):
    case_dir = os.path.join(root, label)
    os.makedirs(case_dir)
    input_path = os.path.join(case_dir, "input")
    with open(input_path, "wb") as f:
        f.write(os.urandom(64 * 1024))
    bundles = os.path.join(case_dir, "luthen-input")
    proc = subprocess.run(
        luthen_cmd + ["seal", input_path, "--out", bundles] + seal_args,
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        fail(f"[{label}] luthen seal exited {proc.returncode}:\n{proc.stdout}\n{proc.stderr}")
    mnemonics = [read_words(os.path.join(bundles, h)) for h in holders]
    secret = shamir_recover(mnemonics)
    out_path = os.path.join(case_dir, "out")
    age_decrypt(os.path.join(bundles, holders[0], "input.age"), out_path, secret)
    with open(input_path, "rb") as a, open(out_path, "rb") as b:
        if a.read() != b.read():
            fail(f"[{label}] decrypted output differs from input")
    print(f"ok: {label}")


def main():
    if len(sys.argv) != 2:
        fail('usage: interop.py "<luthen-cmd>"')
    luthen_cmd = shlex.split(sys.argv[1])
    with tempfile.TemporaryDirectory() as root:
        run_case(
            "flat", luthen_cmd,
            ["--shares", "5", "--threshold", "3", "--names", "a,b,c,d,e"],
            ["b", "d", "e"], root,
        )
        run_case(
            "groups", luthen_cmd,
            ["--group-threshold", "2", "--group", "1/1", "--group", "3/5"],
            ["group-1-share-1", "group-2-share-1", "group-2-share-3", "group-2-share-5"], root,
        )
    print("interop: all cases passed")


if __name__ == "__main__":
    main()
