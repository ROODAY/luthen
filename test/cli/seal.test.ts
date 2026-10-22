import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MAIN = resolve(import.meta.dir, "../../src/cli/main.ts");
const T = 60_000;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "luthen-seal-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(args: string[], stdin?: string) {
  const p = Bun.spawn(["bun", MAIN, ...args], {
    cwd: dir,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}

const BUNDLE_FILES = ["RECOVERY.md", "secret.txt.age", "share.txt", "slip39-wordlist.txt"];

function secretFile(): string {
  const f = join(dir, "secret.txt");
  writeFileSync(f, "top secret");
  return f;
}

test("seal 3-of-5 writes 5 bundles with the 4 files; .age identical across bundles", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "5", "--threshold", "3", "--out", "o"]);
  expect(r.code).toBe(0);
  const bundles = readdirSync(join(dir, "o")).sort();
  expect(bundles).toEqual(["share-1", "share-2", "share-3", "share-4", "share-5"]);
  const ages = new Set<string>();
  for (const b of bundles) {
    expect(readdirSync(join(dir, "o", b)).sort()).toEqual(BUNDLE_FILES);
    ages.add(readFileSync(join(dir, "o", b, "secret.txt.age")).toString("hex"));
  }
  expect(ages.size).toBe(1);
  expect(r.out).toContain("untouched");
  expect(readFileSync(join(dir, "o", "share-1", "RECOVERY.md"), "utf8")).toContain("any 3 of 5 shares");
}, T);

test("--names labels bundle dirs and share.txt Label", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "3", "--threshold", "2", "--names", "alice,bob,carol", "--out", "o"]);
  expect(r.code).toBe(0);
  expect(readdirSync(join(dir, "o")).sort()).toEqual(["alice", "bob", "carol"]);
  expect(readFileSync(join(dir, "o", "bob", "share.txt"), "utf8")).toContain("Label:    bob");
}, T);

test("groups --group-threshold 2 --group 1/1 --group 3/5 writes group-1-share-1 … group-2-share-5", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--group-threshold", "2", "--group", "1/1", "--group", "3/5", "--out", "o"]);
  expect(r.code).toBe(0);
  expect(readdirSync(join(dir, "o")).sort()).toEqual([
    "group-1-share-1",
    "group-2-share-1",
    "group-2-share-2",
    "group-2-share-3",
    "group-2-share-4",
    "group-2-share-5",
  ]);
  expect(readFileSync(join(dir, "o", "group-1-share-1", "RECOVERY.md"), "utf8")).toContain(
    "2 of 2 groups; group 1 needs 1 of 1, group 2 needs 3 of 5",
  );
}, T);

test("stdin input with --name vault", async () => {
  const r = await run(["seal", "-", "--shares", "2", "--threshold", "2", "--out", "o"], "piped data");
  expect(r.code).toBe(0);
  expect(readdirSync(join(dir, "o", "share-1")).sort()).toEqual([
    "RECOVERY.md",
    "share.txt",
    "slip39-wordlist.txt",
    "vault.age",
  ]);
  const r2 = await run(["seal", "-", "--shares", "2", "--threshold", "2", "--name", "vault", "--out", "o2"], "x");
  expect(r2.code).toBe(0);
  expect(existsSync(join(dir, "o2", "share-2", "vault.age"))).toBe(true);
}, T);

test("existing --out dir → exit 1, nothing read or written", async () => {
  const f = secretFile();
  await run(["seal", f, "--shares", "2", "--threshold", "2", "--out", "o"]);
  const before = readdirSync(dir).sort();
  // stdin input would block/consume if read; "ignore" stdin gives empty read, so assert via message instead
  const r = await run(["seal", "-", "--shares", "2", "--threshold", "2", "--out", "o"], "should not be read");
  expect(r.code).toBe(1);
  expect(r.err).toContain("error:");
  expect(r.err).toContain("already exists");
  expect(readdirSync(dir).sort()).toEqual(before);
}, T);

test("--threshold 6 --shares 5 → exit 2 with message", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "5", "--threshold", "6"]);
  expect(r.code).toBe(2);
  expect(r.err.length).toBeGreaterThan(0);
  expect(r.err).not.toContain("    at ");
  expect(readdirSync(dir)).toEqual(["secret.txt"]);
});

test("--names count mismatch → exit 2", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "3", "--threshold", "2", "--names", "a,b"]);
  expect(r.code).toBe(2);
  expect(r.err).toContain("--names");
});

test("--names rejects duplicates and unsafe characters → exit 2", async () => {
  const f = secretFile();
  expect((await run(["seal", f, "--shares", "2", "--threshold", "2", "--names", "a,a"])).code).toBe(2);
  expect((await run(["seal", f, "--shares", "2", "--threshold", "2", "--names", "a,../b"])).code).toBe(2);
});

test("unknown flag → exit 2", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "2", "--threshold", "2", "--bogus"]);
  expect(r.code).toBe(2);
});

test("input file untouched by default", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "2", "--threshold", "2", "--out", "o"]);
  expect(r.code).toBe(0);
  expect(readFileSync(f, "utf8")).toBe("top secret");
}, T);

test("--shred --yes removes input after bundles exist", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "2", "--threshold", "2", "--out", "o", "--shred", "--yes"]);
  expect(r.code).toBe(0);
  expect(existsSync(f)).toBe(false);
  expect(existsSync(join(dir, "o", "share-1", "secret.txt.age"))).toBe(true);
  expect(r.err).toContain("SSD");
  expect(r.err).toContain("BitLocker");
}, T);

test("--shred asks for confirmation; wrong answer keeps the file", async () => {
  const f = secretFile();
  const r = await run(["seal", f, "--shares", "2", "--threshold", "2", "--out", "o", "--shred"], "no\n");
  expect(r.code).toBe(0);
  expect(existsSync(f)).toBe(true);
  const f2 = join(dir, "other.txt");
  writeFileSync(f2, "x");
  const r2 = await run(["seal", f2, "--shares", "2", "--threshold", "2", "--out", "o2", "--shred"], "shred\n");
  expect(r2.code).toBe(0);
  expect(existsSync(f2)).toBe(false);
}, T);

test("--shred with stdin → exit 2", async () => {
  const r = await run(["seal", "-", "--shares", "2", "--threshold", "2", "--shred", "--yes"], "x");
  expect(r.code).toBe(2);
  expect(r.err).toContain("--shred");
});

test("no leftover .partial dirs after success", async () => {
  const f = secretFile();
  await run(["seal", f, "--shares", "2", "--threshold", "2", "--out", "o"]);
  expect(readdirSync(dir).filter((n) => n.includes(".partial"))).toEqual([]);
}, T);
