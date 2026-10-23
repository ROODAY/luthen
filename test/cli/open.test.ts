import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "./cli";
import { decodeMnemonic, encodeMnemonic, mnemonicToIndices } from "../../src/core/slip39/mnemonic";
import { normalizeShareInput } from "../../src/core/sharefile";

const T = 60_000;
const PLAINTEXT = "top secret";
let fixture: string;
let other: string;
let dir: string;

async function runIn(cwd: string, args: string[], stdin?: string) {
  const p = Bun.spawn([...CLI, ...args], {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
  const bytes = new Uint8Array(stdout);
  return { out: new TextDecoder().decode(bytes), bytes, err, code };
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

test("open with 3 -s share.txt and -o out writes the plaintext", async () => {
  const r = await run(["open", age(), "-s", share(1), "-s", share(2), "-s", share(3), "-o", "out.txt"]);
  expect(r.code).toBe(0);
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(PLAINTEXT);
}, T);

test("open with 1 file arg + 2 shares piped on stdin", async () => {
  const r = await run(["open", age(), "-s", share(1), "-o", "out.txt"], shareText(2) + "\n" + shareText(3) + "\n");
  expect(r.code).toBe(0);
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(PLAINTEXT);
  expect(r.err).toContain("shares: have 2, need 3");
  expect(r.err).toContain("shares: have 3, need 3 ✓");
}, T);

test.skipIf(process.platform === "win32")("open -o writes the plaintext with mode 0600", async () => {
  const r = await run(["open", age(), "-s", share(1), "-s", share(2), "-s", share(3), "-o", "out.txt"]);
  expect(r.code).toBe(0);
  expect(statSync(join(dir, "out.txt")).mode & 0o777).toBe(0o600);
}, T);

test("open -o - writes plaintext to stdout only", async () => {
  const r = await run(["open", age(), "-s", share(1), "-s", share(2), "-s", share(3), "-o", "-"]);
  expect(r.code).toBe(0);
  expect(r.out).toBe(PLAINTEXT);
}, T);

test("open -o - writes a large binary file byte-for-byte to a slow reader", async () => {
  const input = new Uint8Array(4 * 1024 * 1024);
  for (let i = 0; i < input.length; i += 65536) crypto.getRandomValues(input.subarray(i, i + 65536));
  writeFileSync(join(dir, "big.bin"), input);
  expect((await run(["seal", "big.bin", "--shares", "2", "--threshold", "2", "--out", "o"])).code).toBe(0);
  const s = (n: number) => join(dir, "o", `share-${n}`, "share.txt");
  // Read slowly so the pipe fills and the CLI's write is still pending when it would zero the buffer.
  const p = Bun.spawn([...CLI, "open", join(dir, "o", "share-1", "big.bin.age"), "-s", s(1), "-s", s(2), "-o", "-"], {
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of p.stdout) {
    chunks.push(chunk);
    await Bun.sleep(2);
  }
  expect(await p.exited).toBe(0);
  expect(Buffer.compare(Buffer.concat(chunks), input)).toBe(0);
}, T);

test("open -o existing → exit 1, file unchanged", async () => {
  writeFileSync(join(dir, "out.txt"), "keep me");
  const r = await run(["open", age(), "-s", share(1), "-s", share(2), "-s", share(3), "-o", "out.txt"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("refusing to overwrite");
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("keep me");
}, T);

test("open: duplicate share re-prompts, not counted", async () => {
  const r = await run(
    ["open", age(), "-s", share(1), "-o", "out.txt"],
    shareText(1) + "\n\n" + shareText(2) + "\n" + shareText(3) + "\n",
  );
  expect(r.code).toBe(0);
  expect(r.err).toContain("more than once");
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(PLAINTEXT);
}, T);

test("open: share from another seal is rejected with set ids", async () => {
  const foreign = normalizeShareInput(readFileSync(join(other, "o", "share-1", "share.txt"), "utf8"));
  const r = await run(["open", age(), "-s", share(1), "-o", "out.txt"], foreign + "\n" + shareText(2) + "\n" + shareText(3) + "\n");
  expect(r.code).toBe(0);
  expect(r.err).toMatch(/different sets \(identifier \d+ vs \d+\)/);
}, T);

test("open: EOF with 2 of 3 → exit 1 NOT_ENOUGH_SHARES", async () => {
  const r = await run(["open", age(), "-s", share(1), "-o", "out.txt"], shareText(2) + "\n");
  expect(r.code).toBe(1);
  expect(r.err).toContain("shares: have 2, need 3");
  expect(r.err).toMatch(/not enough shares/i);
  expect(existsSync(join(dir, "out.txt"))).toBe(false);
}, T);

test("open with no -o and non-TTY stdin → exit 2", async () => {
  const r = await run(["open", age(), "-s", share(1), "-s", share(2), "-s", share(3)]);
  expect(r.code).toBe(2);
}, T);

test("verify one share.txt → exit 0, prints valid and have 1, need 3", async () => {
  const r = await run(["verify", age(), "-s", share(1)]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("1 share valid");
  expect(r.out).toContain("shares: have 1, need 3");
  expect(r.out).not.toContain("unlocks");
}, T);

test("verify 3 share.txt → prints unlocks, writes nothing", async () => {
  const r = await run(["verify", age(), "-s", share(1), "--share", share(2), "-s", share(3)]);
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
  const r = await run(["verify", age(), "-s", join(dir, "bad.txt")]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("error:");
}, T);

test("open/verify reject share files given as extra positionals → exit 2 pointing at -s", async () => {
  const a = await run(["open", age(), share(1), "-o", "out.txt"]);
  expect(a.code).toBe(2);
  expect(a.err).toContain("-s/--share");
  const b = await run(["verify", age(), share(1)]);
  expect(b.code).toBe(2);
  expect(b.err).toContain("-s/--share");
}, T);

test("open/verify reject - as the .age file or a share file → exit 2", async () => {
  const a = await run(["open", "-", "-s", share(1), "-o", "out.txt"]);
  expect(a.code).toBe(2);
  const b = await run(["open", age(), "-s", "-", "-o", "out.txt"]);
  expect(b.code).toBe(2);
  const c = await run(["verify", age(), "-s", "-"]);
  expect(c.code).toBe(2);
}, T);

test("open: forged share with the right set id and valid checksum → exit 1, no output file", async () => {
  const real = decodeMnemonic(shareText(3));
  const value = real.value.slice();
  value[0] = value[0]! ^ 0xff;
  const forged = encodeMnemonic({ ...real, value });
  const r = await run(["open", age(), "-s", share(1), "-s", share(2), "-o", "out.txt"], forged + "\n");
  expect(r.code).toBe(1);
  expect(r.err).toContain("error:");
  expect(existsSync(join(dir, "out.txt"))).toBe(false);
}, T);

test("open: one share typed as 33 space-separated indices is accepted", async () => {
  const idx = mnemonicToIndices(shareText(3)).join(" ");
  const r = await run(["open", age(), "-s", share(1), "-s", share(2), "-o", "out.txt"], idx + "\n");
  expect(r.code).toBe(0);
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(PLAINTEXT);
}, T);
