import { expect, test } from "bun:test";
import { Decrypter } from "age-encryption";
import { LuthenError } from "../../src/core/errors";
import { describePosition, flat, totalShares, validateScheme } from "../../src/core/scheme";
import { combineMnemonics } from "../../src/core/slip39/index";
import { open, progress, rotationSubsets, seal, verify } from "../../src/core/vault";

const opts = { scryptWorkFactor: 10 };
const plaintext = new TextEncoder().encode("the quick brown fox");
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function code(p: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    if (e instanceof LuthenError) return e.code;
    throw e;
  }
  return undefined;
}

test("seal then open with any 3 of 5 returns the plaintext", async () => {
  const sealed = await seal(plaintext, flat(3, 5), opts);
  expect(sealed.shares).toHaveLength(5);
  for (const picks of [[0, 1, 2], [4, 2, 0], [1, 3, 4], [2, 3, 4]]) {
    const out = await open(sealed.ciphertext, picks.map((i) => sealed.shares[i]!.mnemonic));
    expect(out).toEqual(plaintext);
  }
});

test("ciphertext is a standard age file", async () => {
  const sealed = await seal(plaintext, flat(3, 5), opts);
  expect(new TextDecoder().decode(sealed.ciphertext.slice(0, 21))).toBe("age-encryption.org/v1");
});

test("age passphrase is lowercase hex of the SLIP-39 secret", async () => {
  const sealed = await seal(plaintext, flat(3, 5), opts);
  const S = combineMnemonics(sealed.shares.slice(0, 3).map((s) => s.mnemonic));
  expect(S).toHaveLength(32);
  const d = new Decrypter();
  d.addPassphrase(toHex(S));
  expect(await d.decrypt(sealed.ciphertext)).toEqual(plaintext);
});

test("flat(1, 3) seals as three 1/1 groups and any single share opens", async () => {
  const sealed = await seal(plaintext, flat(1, 3), opts);
  expect(sealed.scheme.groups).toEqual([
    { threshold: 1, count: 1 },
    { threshold: 1, count: 1 },
    { threshold: 1, count: 1 },
  ]);
  for (const s of sealed.shares) expect(await open(sealed.ciphertext, [s.mnemonic])).toEqual(plaintext);
});

test("groups 2 of [1/1, 3/5]: lawyer + 3 friends opens; 5 friends alone -> NOT_ENOUGH_SHARES", async () => {
  const scheme = { groupThreshold: 2, groups: [{ threshold: 1, count: 1 }, { threshold: 3, count: 5 }] };
  const sealed = await seal(plaintext, scheme, opts);
  expect(sealed.shares).toHaveLength(6);
  const lawyer = sealed.shares.filter((s) => s.group === 0).map((s) => s.mnemonic);
  const friends = sealed.shares.filter((s) => s.group === 1).map((s) => s.mnemonic);
  expect(await open(sealed.ciphertext, [...lawyer, ...friends.slice(1, 4)])).toEqual(plaintext);
  expect(await code(open(sealed.ciphertext, friends))).toBe("NOT_ENOUGH_SHARES");
});

test("tampered ciphertext -> DECRYPT_FAILED", async () => {
  const sealed = await seal(plaintext, flat(2, 3), opts);
  const bad = sealed.ciphertext.slice();
  bad[bad.length - 1]! ^= 1;
  expect(await code(open(bad, sealed.shares.slice(0, 2).map((s) => s.mnemonic)))).toBe("DECRYPT_FAILED");
});

test("shares from a different seal -> MIXED_SETS (open)", async () => {
  const a = await seal(plaintext, flat(2, 3), opts);
  const b = await seal(plaintext, flat(2, 3), opts);
  expect(await code(open(a.ciphertext, [a.shares[0]!.mnemonic, b.shares[1]!.mnemonic]))).toBe("MIXED_SETS");
});

test("progress counts per group and reports complete", async () => {
  const scheme = { groupThreshold: 2, groups: [{ threshold: 1, count: 1 }, { threshold: 3, count: 5 }] };
  const sealed = await seal(plaintext, scheme, opts);
  const friends = sealed.shares.filter((s) => s.group === 1).map((s) => s.mnemonic);
  const lawyer = sealed.shares.find((s) => s.group === 0)!.mnemonic;

  const p1 = progress(friends.slice(0, 2));
  expect(p1.identifier).toBe(sealed.identifier);
  expect(p1.groupThreshold).toBe(2);
  expect(p1.groups).toEqual([{ index: 1, threshold: 3, have: 2 }]);
  expect(p1.complete).toBe(false);

  const p2 = progress([lawyer, ...friends.slice(0, 3)]);
  expect(p2.groups).toEqual([
    { index: 0, threshold: 1, have: 1 },
    { index: 1, threshold: 3, have: 3 },
  ]);
  expect(p2.complete).toBe(true);
});

test("progress: same share twice -> DUPLICATE_SHARE", async () => {
  const sealed = await seal(plaintext, flat(2, 3), opts);
  const m = sealed.shares[0]!.mnemonic;
  expect(await code(() => progress([m, m]))).toBe("DUPLICATE_SHARE");
});

test("progress: shares from two seals -> MIXED_SETS", async () => {
  const a = await seal(plaintext, flat(2, 3), opts);
  const b = await seal(plaintext, flat(2, 3), opts);
  expect(await code(() => progress([a.shares[0]!.mnemonic, b.shares[1]!.mnemonic]))).toBe("MIXED_SETS");
});

test("verify with 1 share returns incomplete progress, no decrypt", async () => {
  const sealed = await seal(plaintext, flat(3, 5), opts);
  // Garbage ciphertext would fail any decrypt attempt, so success proves none happened.
  const p = await verify(new Uint8Array([1, 2, 3]), [sealed.shares[0]!.mnemonic]);
  expect(p.complete).toBe(false);
});

test("verify with all 5 shares of a 3-of-5 succeeds; wrong file -> DECRYPT_FAILED", async () => {
  const sealed = await seal(plaintext, flat(3, 5), opts);
  const all = sealed.shares.map((s) => s.mnemonic);
  expect((await verify(sealed.ciphertext, all)).complete).toBe(true);
  const other = await seal(plaintext, flat(3, 5), opts);
  expect(await code(verify(other.ciphertext, all))).toBe("DECRYPT_FAILED");
});

test("rotationSubsets covers every supplied share and each subset is threshold-sized", () => {
  const groups = [
    { index: 0, threshold: 1, members: [0] },
    { index: 2, threshold: 3, members: [0, 1, 2, 3, 4] },
    { index: 5, threshold: 2, members: [1, 3, 4] },
  ];
  const subsets = rotationSubsets(groups, 2);
  const seen = new Set(subsets.flat().map((p) => `${p.group}:${p.member}`));
  for (const g of groups) for (const m of g.members) expect(seen.has(`${g.index}:${m}`)).toBe(true);
  for (const s of subsets) {
    expect(new Set(s.map((p) => p.group)).size).toBe(2);
    for (const g of new Set(s.map((p) => p.group))) {
      const t = groups.find((x) => x.index === g)!.threshold;
      expect(s.filter((p) => p.group === g)).toHaveLength(t);
      expect(new Set(s.filter((p) => p.group === g).map((p) => p.member)).size).toBe(t);
    }
  }
});

test("verify rejects a corrupted surplus share that combine would ignore", async () => {
  const sealed = await seal(plaintext, flat(3, 5), opts);
  const all = sealed.shares.map((s) => s.mnemonic);
  // Swap the last word for another valid-looking word; checksum fails -> INVALID_SHARE.
  const words = all[4]!.split(" ");
  words[words.length - 1] = words[words.length - 1] === "academic" ? "acid" : "academic";
  expect(await code(verify(sealed.ciphertext, [...all.slice(0, 4), words.join(" ")]))).toBe("INVALID_SHARE");
});

test("describePosition flat and groups strings", () => {
  expect(describePosition(flat(3, 5), 0, 1)).toBe("Share 2 of 5 · any 3 needed");
  expect(describePosition(flat(1, 3), 2, 0)).toBe("Share 3 of 3 · any 1 needed");
  const scheme = { groupThreshold: 2, groups: [{ threshold: 1, count: 1 }, { threshold: 3, count: 5 }] };
  expect(describePosition(scheme, 1, 0)).toBe(
    "Group 2, member 1 of 5 · 3 of 5 needed from this group · 2 of 2 groups needed",
  );
  expect(totalShares(scheme)).toBe(6);
});

test("validateScheme rejects threshold > shares, 0, >16", () => {
  const bad = (s: Parameters<typeof validateScheme>[0]) => {
    try {
      validateScheme(s);
    } catch (e) {
      return e instanceof LuthenError ? e.code : "other";
    }
    return "none";
  };
  expect(bad(flat(6, 5))).toBe("BAD_SCHEME");
  expect(bad(flat(0, 5))).toBe("BAD_SCHEME");
  expect(bad(flat(3, 17))).toBe("BAD_SCHEME");
  expect(bad(flat(1, 17))).toBe("BAD_SCHEME");
  expect(bad({ groupThreshold: 3, groups: [{ threshold: 1, count: 1 }] })).toBe("BAD_SCHEME");
  expect(bad({ groupThreshold: 1, groups: [{ threshold: 1, count: 2 }] })).toBe("BAD_SCHEME");
  expect(bad(flat(3, 5))).toBe("none");
});
