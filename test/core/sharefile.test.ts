import { expect, test } from "bun:test";
import { LuthenError } from "../../src/core/errors";
import { renderShareFile, normalizeShareInput, type ShareFileInfo } from "../../src/core/sharefile";
import { WORDLIST } from "../../src/core/slip39/wordlist";

const indices = Array.from({ length: 33 }, (_, i) => (i * 31 + 4) % 1024);
const valid = indices.map((i) => WORDLIST[i]!).join(" ");
const info: ShareFileInfo = {
  label: "alice",
  position: "Share 1 of 5 · any 3 needed",
  identifier: 12345,
  fileName: "vault.age",
  created: new Date("2026-10-22T12:00:00Z"),
  mnemonic: valid,
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof LuthenError) return e.code;
    throw e;
  }
  return undefined;
}

test("render then normalize round-trips the mnemonic", () => {
  expect(normalizeShareInput(renderShareFile(info))).toBe(valid);
});

test("normalize: bare words", () => {
  expect(normalizeShareInput(valid)).toBe(valid);
});

test("normalize: numbered, CRLF, UPPERCASE, blank lines", () => {
  const messy = valid.split(" ").map((w, i) => `${i + 1}. ${w.toUpperCase()}`).join("\r\n\r\n");
  expect(normalizeShareInput(messy)).toBe(valid);
});

test("normalize: other numbering styles and tabs", () => {
  const a = valid.split(" ").map((w, i) => `${i + 1}\t${w}`).join("\n");
  const b = valid.split(" ").map((w, i) => `${i + 1}) ${w}`).join("\n");
  expect(normalizeShareInput(a)).toBe(valid);
  expect(normalizeShareInput(b)).toBe(valid);
});

test("normalize: indices form", () => {
  expect(normalizeShareInput(indices.join(" "))).toBe(valid);
  expect(normalizeShareInput(indices.join("\r\n"))).toBe(valid);
});

test("normalize: unknown word error names it and its position", () => {
  const words = valid.split(" ");
  words[4] = "zzzz";
  expect(() => normalizeShareInput(words.join(" "))).toThrow(/word 5.*zzzz|zzzz.*word 5/);
  expect(codeOf(() => normalizeShareInput(words.join(" ")))).toBe("INVALID_SHARE");
});

test("normalize: out-of-range index is INVALID_SHARE", () => {
  const bad = [...indices];
  bad[2] = 1024;
  expect(codeOf(() => normalizeShareInput(bad.join(" ")))).toBe("INVALID_SHARE");
});

test("normalize: empty input is INVALID_SHARE", () => {
  expect(codeOf(() => normalizeShareInput("  \n "))).toBe("INVALID_SHARE");
});

test("normalize: words and indices blocks disagree -> INVALID_SHARE", () => {
  const file = renderShareFile(info);
  const other = [...indices];
  other[0] = (other[0]! + 1) % 1024;
  const tampered = file.replace(/(-----BEGIN SLIP-39 WORD INDICES-----\n)[\s\S]*?(\n-----END)/, `$1${other.join(" ")}$2`);
  expect(tampered).not.toBe(file);
  expect(codeOf(() => normalizeShareInput(tampered))).toBe("INVALID_SHARE");
});

test("share file contains header fields and 33 numbered words", () => {
  const text = renderShareFile(info);
  expect(text.startsWith("LUTHEN SHARE · format v1 · SLIP-39 + age (passphrase)\n")).toBe(true);
  for (const s of [
    "Label:    alice",
    "Position: Share 1 of 5 · any 3 needed",
    "Set ID:   12345",
    "File:     vault.age",
    "Created:  2026-10-22",
    "-----BEGIN SLIP-39 WORDS-----",
    "-----END SLIP-39 WORD INDICES-----",
    "Keep this private. See RECOVERY.md for how to recover.",
  ])
    expect(text).toContain(s);
  const block = text.split("-----BEGIN SLIP-39 WORDS-----\n")[1]!.split("-----END SLIP-39 WORDS-----")[0]!;
  const lines = block.trimEnd().split("\n");
  expect(lines.length).toBe(11);
  const cells = lines.flatMap((l) => [...l.matchAll(/\s*(\d+) (\w+)/g)].map((m) => [Number(m[1]), m[2]!] as const));
  expect(cells.length).toBe(33);
  // numbered top-to-bottom: row r, column c holds word r + 11c
  expect(lines[0]!.trim().startsWith("1 " + valid.split(" ")[0])).toBe(true);
  expect(cells.find(([n]) => n === 12)![1]).toBe(valid.split(" ")[11]!);
  const idxBlock = text.split("-----BEGIN SLIP-39 WORD INDICES-----\n")[1]!.split("\n-----END")[0]!;
  expect(idxBlock.split("\n").map((l) => l.split(" ").length)).toEqual([11, 11, 11]);
});
