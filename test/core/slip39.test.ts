import { expect, test } from "bun:test";
import vectorsJson from "../fixtures/vectors.json";
import { LuthenError, type ErrorCode } from "../../src/core/errors";
import { decodeMnemonic } from "../../src/core/slip39/mnemonic";
import { combineMnemonics, generateMnemonics } from "../../src/core/slip39";

const vectors = vectorsJson as [string, string[], string, string][];

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const secret = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);

function expectCode(fn: () => unknown, code: ErrorCode): LuthenError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LuthenError);
    expect((e as LuthenError).code).toBe(code);
    return e as LuthenError;
  }
  throw new Error(`expected LuthenError ${code}, nothing was thrown`);
}

function subsets<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...subsets(rest, k - 1).map((s) => [first!, ...s]), ...subsets(rest, k)];
}

test("official vectors", () => {
  let valid = 0;
  let invalid = 0;
  for (const [desc, mnemonics, secretHex] of vectors) {
    if (secretHex) {
      expect(toHex(combineMnemonics(mnemonics, "TREZOR")), desc).toBe(secretHex);
      valid++;
    } else {
      expect(() => combineMnemonics(mnemonics, "TREZOR"), desc).toThrow(LuthenError);
      invalid++;
    }
  }
  expect(valid + invalid).toBe(45);
  expect(invalid).toBeGreaterThan(20);
});

test("official invalid vectors fail with the expected error code", () => {
  const expected: [number, ErrorCode][] = [
    [6, "MIXED_SETS"], // different identifiers
    [7, "MIXED_SETS"], // different iteration exponents
    [8, "MIXED_SETS"], // mismatching group thresholds
    [9, "MIXED_SETS"], // mismatching group counts
    [11, "DUPLICATE_SHARE"],
    [12, "MIXED_SETS"], // mismatching member thresholds
    [13, "INVALID_SHARE"], // invalid digest
    [14, "NOT_ENOUGH_SHARES"],
    [15, "NOT_ENOUGH_SHARES"],
    [16, "NOT_ENOUGH_SHARES"],
    [2, "INVALID_SHARE"], // checksum
    [3, "INVALID_SHARE"], // padding
    [39, "INVALID_SHARE"], // length
    [40, "INVALID_SHARE"], // master secret length
  ];
  for (const [n, code] of expected) expectCode(() => combineMnemonics(vectors[n - 1]![1], "TREZOR"), code);
});

test("flat 3-of-5 round trip, every 3-subset", () => {
  const groups = generateMnemonics(1, [{ threshold: 3, count: 5 }], secret);
  expect(groups.length).toBe(1);
  expect(groups[0]!.length).toBe(5);
  for (const m of groups[0]!) expect(m.split(" ").length).toBe(33);
  const all = subsets(groups[0]!, 3);
  expect(all.length).toBe(10);
  for (const s of all) expect(toHex(combineMnemonics(s))).toBe(toHex(secret));
});

test("passphrase round trip; wrong passphrase yields a different secret", () => {
  const [g] = generateMnemonics(1, [{ threshold: 2, count: 3 }], secret, "hunter2");
  expect(toHex(combineMnemonics(g!.slice(0, 2), "hunter2"))).toBe(toHex(secret));
  expect(toHex(combineMnemonics(g!.slice(1, 3), ""))).not.toBe(toHex(secret));
});

test("16-byte secret round trip", () => {
  const s = secret.slice(0, 16);
  const [g] = generateMnemonics(1, [{ threshold: 2, count: 2 }], s);
  expect(g![0]!.split(" ").length).toBe(20);
  expect(toHex(combineMnemonics(g!))).toBe(toHex(s));
});

test("groups: 2 of [1/1, 3/5]", () => {
  const [lawyer, friends] = generateMnemonics(
    2,
    [
      { threshold: 1, count: 1 },
      { threshold: 3, count: 5 },
    ],
    secret,
  );
  expect(lawyer!.length).toBe(1);
  expect(friends!.length).toBe(5);
  for (const three of subsets(friends!, 3))
    expect(toHex(combineMnemonics([lawyer![0]!, ...three]))).toBe(toHex(secret));
  expectCode(() => combineMnemonics(friends!), "NOT_ENOUGH_SHARES");
  expectCode(() => combineMnemonics([lawyer![0]!, ...friends!.slice(0, 2)]), "NOT_ENOUGH_SHARES");
});

test("2 of 5 shares → NOT_ENOUGH_SHARES", () => {
  const [g] = generateMnemonics(1, [{ threshold: 3, count: 5 }], secret);
  expectCode(() => combineMnemonics(g!.slice(0, 2)), "NOT_ENOUGH_SHARES");
});

test("no shares → NOT_ENOUGH_SHARES", () => {
  expectCode(() => combineMnemonics([]), "NOT_ENOUGH_SHARES");
});

test("duplicate share → DUPLICATE_SHARE", () => {
  const [g] = generateMnemonics(1, [{ threshold: 3, count: 5 }], secret);
  expectCode(() => combineMnemonics([g![0]!, g![1]!, g![0]!]), "DUPLICATE_SHARE");
});

test("mixing two sets → MIXED_SETS mentioning both ids", () => {
  let a: string[];
  let b: string[];
  do {
    a = generateMnemonics(1, [{ threshold: 2, count: 3 }], secret)[0]!;
    b = generateMnemonics(1, [{ threshold: 2, count: 3 }], secret)[0]!;
  } while (decodeMnemonic(a[0]!).identifier === decodeMnemonic(b[0]!).identifier);
  const e = expectCode(() => combineMnemonics([a[0]!, b[1]!]), "MIXED_SETS");
  expect(e.message).toContain(String(decodeMnemonic(a[0]!).identifier));
  expect(e.message).toContain(String(decodeMnemonic(b[0]!).identifier));
});

test("threshold 1 with count 3 → BAD_SCHEME", () => {
  expectCode(() => generateMnemonics(1, [{ threshold: 1, count: 3 }], secret), "BAD_SCHEME");
});

test("17 members → BAD_SCHEME", () => {
  expectCode(() => generateMnemonics(1, [{ threshold: 2, count: 17 }], secret), "BAD_SCHEME");
});

test("other scheme violations → BAD_SCHEME", () => {
  const g = { threshold: 1, count: 1 };
  expectCode(() => generateMnemonics(1, Array(17).fill(g), secret), "BAD_SCHEME");
  expectCode(() => generateMnemonics(1, [{ threshold: 4, count: 3 }], secret), "BAD_SCHEME");
  expectCode(() => generateMnemonics(1, [{ threshold: 0, count: 3 }], secret), "BAD_SCHEME");
  expectCode(() => generateMnemonics(2, [g], secret), "BAD_SCHEME");
  expectCode(() => generateMnemonics(0, [g], secret), "BAD_SCHEME");
  expectCode(() => generateMnemonics(1, [], secret), "BAD_SCHEME");
  expectCode(() => generateMnemonics(1, [g], secret.slice(0, 14)), "BAD_SCHEME");
  expectCode(() => generateMnemonics(1, [g], secret.slice(0, 17)), "BAD_SCHEME");
  expectCode(() => generateMnemonics(1, [g], secret, "", 16), "BAD_SCHEME");
});

test("generated shares have extendable flag and iteration exponent 1", () => {
  const groups = generateMnemonics(
    2,
    [
      { threshold: 1, count: 1 },
      { threshold: 3, count: 5 },
    ],
    secret,
  );
  const shares = groups.flat().map(decodeMnemonic);
  expect(new Set(shares.map((s) => s.identifier)).size).toBe(1);
  for (const s of shares) {
    expect(s.extendable).toBe(true);
    expect(s.iterationExponent).toBe(1);
    expect(s.groupThreshold).toBe(2);
    expect(s.groupCount).toBe(2);
  }
});
