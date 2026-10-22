import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeShareInput } from "../../src/core/sharefile";

const MAIN = resolve(import.meta.dir, "../../src/cli/main.ts");
const T = 60_000;
const PLAINTEXT = "top secret";
let fixture: string;
let other: string;
let dir: string;

async function runIn(cwd: string, args: string[], stdin?: string) {
  const p = Bun.spawn(["bun", MAIN, ...args], {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}
const run = (args: string[], stdin?: string) => runIn(dir, args, stdin);

const age = () => join(fixture, "o", "share-1", "secret.txt.age");
const share = (n: number) => join(fixture, "o", `share-${n}`, "share.txt");
const shareText = (n: number) => normalizeShareInput(readFileSync(share(n), "utf8"));

beforeAll(async () => {
  fixture = mkdtempSync(join(tmpdir(), "luthen-open-fx-"));
  other = mkdtempSync(join(tmpdir(), "luthen-open-fx2-"));
  writeFileSync(join(fixture, "secret.txt"), PLAINTEXT);
  writeFileSync(join(other, "secret.txt"), PLAINTEXT);
  await runIn(fixture, ["seal", "secret.txt", "--shares", "3", "--threshold", "3", "--out", "o"]);
  await runIn(other, ["seal", "secret.txt", "--shares", "3", "--threshold", "3", "--out", "o"]);
}, 120_000);
afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "luthen-open-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("open with 3 share.txt args and -o out writes the plaintext", async () => {
  const r = await run(["open", age(), share(1), share(2), share(3), "-o", "out.txt"]);
  expect(r.code).toBe(0);
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(PLAINTEXT);
}, T);

test("open with 1 file arg + 2 shares piped on stdin", async () => {
  const r = await run(["open", age(), share(1), "-o", "out.txt"], shareText(2) + "\n" + shareText(3) + "\n");
  expect(r.code).toBe(0);
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(PLAINTEXT);
  expect(r.err).toContain("2 of 3 needed");
  expect(r.err).toContain("3 of 3 needed");
}, T);

test("open -o - writes plaintext to stdout only", async () => {
  const r = await run(["open", age(), share(1), share(2), share(3), "-o", "-"]);
  expect(r.code).toBe(0);
  expect(r.out).toBe(PLAINTEXT);
}, T);

test("open -o existing → exit 1, file unchanged", async () => {
  writeFileSync(join(dir, "out.txt"), "keep me");
  const r = await run(["open", age(), share(1), share(2), share(3), "-o", "out.txt"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("refusing to overwrite");
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("keep me");
}, T);

test("open: duplicate share re-prompts, not counted", async () => {
  const r = await run(
    ["open", age(), share(1), "-o", "out.txt"],
    shareText(1) + "\n\n" + shareText(2) + "\n" + shareText(3) + "\n",
  );
  expect(r.code).toBe(0);
  expect(r.err).toContain("more than once");
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(PLAINTEXT);
}, T);

test("open: share from another seal is rejected with set ids", async () => {
  const foreign = normalizeShareInput(readFileSync(join(other, "o", "share-1", "share.txt"), "utf8"));
  const r = await run(["open", age(), share(1), "-o", "out.txt"], foreign + "\n" + shareText(2) + "\n" + shareText(3) + "\n");
  expect(r.code).toBe(0);
  expect(r.err).toMatch(/different sets \(identifier \d+ vs \d+\)/);
}, T);

test("open: EOF with 2 of 3 → exit 1 NOT_ENOUGH_SHARES", async () => {
  const r = await run(["open", age(), share(1), "-o", "out.txt"], shareText(2) + "\n");
  expect(r.code).toBe(1);
  expect(r.err).toContain("2 of 3 needed");
  expect(r.err).toMatch(/not enough shares/i);
  expect(existsSync(join(dir, "out.txt"))).toBe(false);
}, T);

test("open with no -o and non-TTY stdin → exit 2", async () => {
  const r = await run(["open", age(), share(1), share(2), share(3)]);
  expect(r.code).toBe(2);
}, T);

test("verify one share.txt → exit 0, prints valid and 1 of 3", async () => {
  const r = await run(["verify", age(), share(1)]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("1 share valid");
  expect(r.out).toContain("1 of 3 needed");
  expect(r.out).not.toContain("unlocks");
}, T);

test("verify 3 share.txt → prints unlocks, writes nothing", async () => {
  const r = await run(["verify", age(), share(1), share(2), share(3)]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("3 shares valid");
  expect(r.out).toContain("unlocks secret.txt.age");
  expect(readdirSync(dir)).toEqual([]);
}, T);

test("verify with no share files prompts for one", async () => {
  const r = await run(["verify", age()], shareText(1) + "\n");
  expect(r.code).toBe(0);
  expect(r.out).toContain("1 share valid");
}, T);

test("verify a corrupted share.txt → exit 1", async () => {
  const bad = readFileSync(share(1), "utf8").replace(
    /(BEGIN SLIP-39 WORDS-----\s*(?:\d+\s+)?)([a-z]+)/,
    (_m, pre: string, w: string) => pre + (w === "academic" ? "acid" : "academic"),
  );
  writeFileSync(join(dir, "bad.txt"), bad);
  const r = await run(["verify", age(), join(dir, "bad.txt")]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("error:");
}, T);
