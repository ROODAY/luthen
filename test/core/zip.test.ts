import { expect, test } from "bun:test";
import { isZip, unzipFiles, zipFiles } from "../../src/core/zip";

const mtime = new Date("2026-01-02T03:04:06Z");
const bin = new Uint8Array([0, 1, 2, 255, 254]);

test("zip round trip preserves paths and bytes", () => {
  const out = unzipFiles(zipFiles({ "a/x.txt": "hi", "a/y.bin": bin }, mtime));
  const byPath = Object.fromEntries(out.map((e) => [e.path, e.bytes]));
  expect(Object.keys(byPath).sort()).toEqual(["a/x.txt", "a/y.bin"]);
  expect(new TextDecoder().decode(byPath["a/x.txt"])).toBe("hi");
  expect(Array.from(byPath["a/y.bin"]!)).toEqual(Array.from(bin));
});

test("same input and mtime give byte-identical zips", () => {
  const a = zipFiles({ "a/x.txt": "hi", "a/y.bin": bin }, mtime);
  const b = zipFiles({ "a/x.txt": "hi", "a/y.bin": bin }, mtime);
  expect(Array.from(a)).toEqual(Array.from(b));
});

test("isZip", () => {
  expect(isZip(zipFiles({ "x": "hi" }, mtime))).toBe(true);
  expect(isZip(new TextEncoder().encode("age-encryption.org/v1\n"))).toBe(false);
});
