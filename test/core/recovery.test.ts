import { expect, test } from "bun:test";
import { renderRecovery, renderWordlist } from "../../src/core/recovery";

const md = renderRecovery({ fileName: "vault.age", schemeSummary: "any 3 of 5 shares", identifier: 12345, version: "1.0.0" });

test("recovery card contains both recovery paths, spec links, and the scheme line", () => {
  for (const s of [
    "shamir recover",
    "pipx install 'shamir-mnemonic[cli]'",
    "python3 -m venv luthen-recovery && luthen-recovery/bin/pip install 'shamir-mnemonic[cli]'",
    "luthen-recovery/bin/shamir",
    "tested with shamir-mnemonic 0.3.0",
    "SLIP-39 passphrase is empty",
    "numbered order",
    "top to bottom",
    "https://github.com/FiloSottile/age",
    "-s alice/share.txt -s bob/share.txt",
    "prompted for any missing ones",
    "age -d",
    "vault.age",
    "any 3 of 5 shares",
    "12345",
    "luthen open",
    "slip-0039.md",
    "age-encryption.org/v1",
    "lowercase hex",
    "https://github.com/satoshilabs/slips/blob/master/slip-0039.md",
    "Luthen format v1: SLIP-39 (extendable, empty passphrase) splits a 256-bit secret S; the file is age v1 scrypt-passphrase encrypted with passphrase = lowercase hex(S).",
  ])
    expect(md).toContain(s);
});

test("recovery card sections appear in order", () => {
  const order = [
    "offline",
    "any 3 of 5 shares",
    "luthen open",
    "pipx install",
    "shamir recover",
    "slip39-wordlist.txt",
    "FiloSottile/age",
    "age -d",
    "slip-0039.md",
    "Luthen format v1:",
  ];
  const pos = order.map((s) => md.indexOf(s));
  expect(pos.every((p) => p >= 0)).toBe(true);
  expect([...pos].sort((a, b) => a - b)).toEqual(pos);
});

test("recovery card drops the old pip line, the passphrase-prompt claim, and the repeated share.txt example", () => {
  expect(md).not.toContain("pip install shamir-mnemonic[cli]");
  expect(md).not.toContain("passphrase prompt");
  expect(md).not.toContain("share.txt share.txt");
});

test("wordlist render has 1024 lines", () => {
  const w = renderWordlist();
  expect(w.endsWith("\n")).toBe(true);
  expect(w.trimEnd().split("\n").length).toBe(1024);
  expect(w.split("\n")[0]).toBe("academic");
});
