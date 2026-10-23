import { beforeAll, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { bundleFiles, type BundleFiles } from "../../src/core/bundle";
import { addFiles, addProblems, addShareText, EMPTY_INPUTS, outputName } from "../../src/core/inputs";
import { flat } from "../../src/core/scheme";
import { normalizeShareInput } from "../../src/core/sharefile";
import { seal } from "../../src/core/vault";
import { zipFiles } from "../../src/core/zip";

const created = new Date("2026-01-02T00:00:00Z");
const enc = new TextEncoder();
const labels = ["alice", "bob", "carol"];

async function makeBundles(secret: string): Promise<BundleFiles> {
  const sealed = await seal(enc.encode(secret), flat(2, 3), { scryptWorkFactor: 10 });
  return bundleFiles({ sealed, labels, name: "secret.txt", schemeSummary: "any 2 of 3 shares", created, version: "test" });
}

let one: BundleFiles;
let two: BundleFiles;

beforeAll(async () => {
  one = await makeBundles("first");
  two = await makeBundles("second");
});

const holderZip = (b: BundleFiles, label: string) => zipFiles(b[label]!, created);
const allZip = (b: BundleFiles) =>
  zipFiles(Object.fromEntries(Object.entries(b).flatMap(([l, fs]) => Object.entries(fs).map(([n, c]) => [`${l}/${n}`, c]))), created);

test("holder zip", () => {
  const s = addFiles(EMPTY_INPUTS, [{ name: "alice.zip", bytes: holderZip(one, "alice") }]);
  expect(s.ciphertext?.name).toBe("secret.txt.age");
  expect(s.shares).toHaveLength(1);
  expect(s.problems).toEqual([]);
});

test("all-in-one zip", () => {
  const s = addFiles(EMPTY_INPUTS, [{ name: "all.zip", bytes: allZip(one) }]);
  expect(s.shares).toHaveLength(3);
  expect(s.ciphertext?.name).toBe("secret.txt.age");
  expect(s.problems).toEqual([]);
});

test("os-made zip", () => {
  const entries: Record<string, Uint8Array> = {};
  for (const [n, c] of Object.entries(one.alice!)) entries[`Archive/alice/${n}`] = typeof c === "string" ? enc.encode(c) : c;
  entries["__MACOSX/Archive/alice/._share.txt"] = new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0]);
  const s = addFiles(EMPTY_INPUTS, [{ name: "Archive.zip", bytes: zipSync(entries, { level: 6 }) }]);
  expect(s.shares).toHaveLength(1);
  expect(s.ciphertext).toBeDefined();
  expect(s.problems).toEqual([]);
});

test("nested zip is expanded one level", () => {
  const s = addFiles(EMPTY_INPUTS, [{ name: "outer.zip", bytes: zipFiles({ "inner.zip": holderZip(one, "bob") }, created) }]);
  expect(s.shares).toHaveLength(1);
  expect(s.shares[0]!.source).toBe("outer.zip/inner.zip/share.txt");
});

test("duplicate share merged", () => {
  let s = addFiles(EMPTY_INPUTS, [{ name: "alice.zip", bytes: holderZip(one, "alice") }]);
  s = addFiles(s, [{ name: "all.zip", bytes: allZip(one) }]);
  expect(s.shares).toHaveLength(3);
  expect(s.problems).toEqual([]);
});

test("foreign share rejected", () => {
  const before = addFiles(EMPTY_INPUTS, [{ name: "alice.zip", bytes: holderZip(one, "alice") }]);
  const snapshot = JSON.stringify(before);
  const s = addFiles(before, [{ name: "share.txt", bytes: enc.encode(two.bob!["share.txt"] as string) }]);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]!.message).toContain("different sets");
  expect(s.shares).toEqual(before.shares);
  expect(s.ciphertext).toBe(before.ciphertext);
  expect(JSON.stringify(before)).toBe(snapshot);
});

test("different age rejected", () => {
  const before = addFiles(EMPTY_INPUTS, [{ name: "alice.zip", bytes: holderZip(one, "alice") }]);
  const s = addFiles(before, [{ name: "secret.txt.age", bytes: two.alice!["secret.txt.age"] as Uint8Array }]);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]!.message).toContain("already loaded");
  expect(s.ciphertext).toBe(before.ciphertext);
});

test("same age ignored", () => {
  const before = addFiles(EMPTY_INPUTS, [{ name: "alice.zip", bytes: holderZip(one, "alice") }]);
  const s = addFiles(before, [{ name: "copy.age", bytes: one.bob!["secret.txt.age"] as Uint8Array }]);
  expect(s.problems).toEqual([]);
  expect(s.ciphertext?.name).toBe("secret.txt.age");
});

test("crlf and bom", () => {
  const text = "\uFEFF" + (one.alice!["share.txt"] as string).replace(/\n/g, "\r\n");
  const s = addFiles(EMPTY_INPUTS, [{ name: "share.txt", bytes: enc.encode(text) }]);
  expect(s.shares).toHaveLength(1);
  expect(s.problems).toEqual([]);
});

test("loose junk", () => {
  const s = addFiles(EMPTY_INPUTS, [{ name: "notes.txt", bytes: enc.encode("hello") }]);
  expect(s.problems).toEqual([{ name: "notes.txt", message: "not a Luthen share or encrypted file" }]);
});

test("loose holder folder files: bundle furniture is skipped silently", () => {
  const toBytes = (c: Uint8Array | string) => (typeof c === "string" ? enc.encode(c) : c);
  const files = Object.entries(one.alice!).map(([name, c]) => ({ name, bytes: toBytes(c) }));
  expect(files.map((f) => f.name).sort()).toEqual(["RECOVERY.md", "secret.txt.age", "share.txt", "slip39-wordlist.txt"]);
  const s = addFiles(EMPTY_INPUTS, files);
  expect(s.ciphertext?.name).toBe("secret.txt.age");
  expect(s.shares).toHaveLength(1);
  expect(s.problems).toEqual([]);
});

test("loose OS junk from a dropped folder is skipped silently, but a real share under such a name still loads", () => {
  const share = enc.encode(one.alice!["share.txt"] as string);
  const s = addFiles(EMPTY_INPUTS, [
    { name: "alice/.DS_Store", bytes: new Uint8Array([0, 0, 0, 1, 66, 117, 100, 49]) },
    { name: "alice/._share.txt", bytes: new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0]) },
    { name: "alice/Thumbs.db", bytes: new Uint8Array([208, 207, 17, 224]) },
    { name: "alice/desktop.ini", bytes: enc.encode("[.ShellClassInfo]\r\n") },
    { name: "__MACOSX/alice/notes.txt", bytes: enc.encode("hello") },
    { name: "alice/.share.txt", bytes: share },
  ]);
  expect(s.problems).toEqual([]);
  expect(s.shares).toHaveLength(1);
});

test("typed share", () => {
  const mnemonic = addFiles(EMPTY_INPUTS, [{ name: "a.zip", bytes: holderZip(one, "alice") }]).shares[0]!.mnemonic;
  const s = addShareText(EMPTY_INPUTS, mnemonic, "typed");
  expect(s.shares).toEqual([{ mnemonic, source: "typed" }]);
  expect(EMPTY_INPUTS.shares).toEqual([]);
});

test("outputName", () => {
  expect(outputName("secret.txt.age")).toBe("secret.txt");
  expect(outputName(".age")).toBe("luthen-output");
  expect(outputName("blob")).toBe("luthen-output");
});

/** Same words with the first two swapped: parses as a share but fails the checksum. */
function badChecksum(text: string): string {
  const m = normalizeShareInput(text).split(" ");
  [m[0], m[1]] = [m[1]!, m[0]!];
  return m.join(" ");
}

test("bad-checksum share loose reports the real reason", () => {
  const bad = badChecksum(one.alice!["share.txt"] as string);
  const s = addFiles(EMPTY_INPUTS, [{ name: "bad.txt", bytes: enc.encode(bad) }]);
  expect(s.shares).toEqual([]);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]!.message.toLowerCase()).toContain("checksum");
});

test("bad-checksum share inside a zip is a Problem, not silent", () => {
  const bad = badChecksum(one.alice!["share.txt"] as string);
  const zip = zipFiles({ "alice/share.txt": bad, "alice/RECOVERY.md": "x" }, created);
  const s = addFiles(EMPTY_INPUTS, [{ name: "z.zip", bytes: zip }]);
  expect(s.shares).toEqual([]);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]!.name).toBe("z.zip/alice/share.txt");
});

test("truncated zip is one Problem and other files still load", () => {
  const good = holderZip(one, "alice");
  const truncated = holderZip(one, "bob").slice(0, 40);
  const s = addFiles(EMPTY_INPUTS, [
    { name: "bad.zip", bytes: truncated },
    { name: "alice.zip", bytes: good },
  ]);
  expect(s.problems).toEqual([{ name: "bad.zip", message: "could not read zip" }]);
  expect(s.shares).toHaveLength(1);
  expect(s.ciphertext?.name).toBe("secret.txt.age");
});

/** Replaces the first share word with a word not on the SLIP-39 list. */
function unknownWord(text: string): string {
  const first = normalizeShareInput(text).split(" ")[0]!;
  return text.replace(new RegExp(` 1 ${first} `), " 1 notaword ");
}

test("share.txt with an unknown word loose reports the real reason", () => {
  const bad = unknownWord(one.alice!["share.txt"] as string);
  const s = addFiles(EMPTY_INPUTS, [{ name: "share.txt", bytes: enc.encode(bad) }]);
  expect(s.shares).toEqual([]);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]!.name).toBe("share.txt");
  expect(s.problems[0]!.message).toContain("unknown word");
});

test("share.txt with an unknown word inside a zip is a Problem, not silent", () => {
  const bad = unknownWord(one.alice!["share.txt"] as string);
  const zip = zipFiles({ "alice/share.txt": bad, "alice/RECOVERY.md": "x", "alice/notes.txt": "hello" }, created);
  const s = addFiles(EMPTY_INPUTS, [{ name: "z.zip", bytes: zip }]);
  expect(s.shares).toEqual([]);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]!.name).toBe("z.zip/alice/share.txt");
  expect(s.problems[0]!.message).toContain("unknown word");
});

test("typed text that is not a share reports the parse error", () => {
  const s = addShareText(EMPTY_INPUTS, "hello zzz", "Typed share 1");
  expect(s.shares).toEqual([]);
  expect(s.problems).toEqual([{ name: "Typed share 1", message: 'unknown word "hello" at word 1' }]);
});

test("addProblems appends without touching the input state", () => {
  const before = addFiles(EMPTY_INPUTS, [{ name: "notes.txt", bytes: enc.encode("hello") }]);
  const s = addProblems(before, [{ name: "alice/share.txt", message: "could not read file" }]);
  expect(s.problems).toEqual([
    { name: "notes.txt", message: "not a Luthen share or encrypted file" },
    { name: "alice/share.txt", message: "could not read file" },
  ]);
  expect(before.problems).toHaveLength(1);
  expect(addProblems(EMPTY_INPUTS, []).problems).toEqual([]);
  expect(EMPTY_INPUTS.problems).toEqual([]);
});
