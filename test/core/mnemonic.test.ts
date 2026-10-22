import { expect, test } from "bun:test";
import vectorsJson from "../fixtures/vectors.json";
import { LuthenError } from "../../src/core/errors";
import {
  decodeMnemonic,
  encodeMnemonic,
  indicesToMnemonic,
  mnemonicToIndices,
} from "../../src/core/slip39/mnemonic";
import { WORDLIST } from "../../src/core/slip39/wordlist";

const vectors = vectorsJson as [string, string[], string, string][];
const valid = vectors[0]![1][0]!;

test("wordlist has 1024 unique words, unique 4-letter prefixes", () => {
  expect(WORDLIST.length).toBe(1024);
  expect(new Set(WORDLIST).size).toBe(1024);
  expect(new Set(WORDLIST.map((w) => w.slice(0, 4))).size).toBe(1024);
});

test("every valid vector mnemonic decodes and re-encodes identically", () => {
  let n = 0;
  for (const [, mnemonics, secret] of vectors)
    if (secret)
      for (const m of mnemonics) {
        expect(encodeMnemonic(decodeMnemonic(m))).toBe(m);
        n++;
      }
  expect(n).toBeGreaterThan(20);
});

test("256-bit share is 33 words", () => {
  const v = vectors.find(([, , secret]) => secret.length === 64)!;
  const m = v[1][0]!;
  expect(m.split(" ").length).toBe(33);
  expect(decodeMnemonic(m).value.length).toBe(32);
});

test("single-word substitution fails checksum with INVALID_SHARE", () => {
  const words = valid.split(" ");
  words[4] = words[4] === WORDLIST[0] ? WORDLIST[1]! : WORDLIST[0]!;
  let err: unknown;
  try {
    decodeMnemonic(words.join(" "));
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(LuthenError);
  expect((err as LuthenError).code).toBe("INVALID_SHARE");
});

test("unknown word throws INVALID_SHARE naming the word", () => {
  expect(() => decodeMnemonic(valid.replace(/^\S+/, "zzzz"))).toThrow(/zzzz/);
});

test("too-short mnemonic is rejected", () => {
  expect(() => decodeMnemonic(valid.split(" ").slice(0, 19).join(" "))).toThrow(LuthenError);
});

test("indices round trip", () => {
  expect(indicesToMnemonic(mnemonicToIndices(valid))).toBe(valid);
});
