import { beforeAll, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { bundleFiles, type BundleFiles } from "../../src/core/bundle";
import { addFiles, addShareText, EMPTY_INPUTS, outputName } from "../../src/core/inputs";
import { flat } from "../../src/core/scheme";
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
