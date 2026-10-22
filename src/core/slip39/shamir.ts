import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { LuthenError } from "../errors";

// Shamir's secret sharing over GF(256), per SLIP-39 and the reference
// implementation (trezor/python-shamir-mnemonic, shamir.py).

export interface RawShare {
  x: number;
  value: Uint8Array;
}

export const MAX_SHARE_COUNT = 16;
const DIGEST_LENGTH = 4;
const DIGEST_INDEX = 254;
const SECRET_INDEX = 255;

// Log/exp tables for GF(256) with the Rijndael polynomial x^8 + x^4 + x^3 + x + 1,
// generator x + 1.
const EXP = new Uint8Array(255);
const LOG = new Uint8Array(256);
{
  let poly = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = poly;
    LOG[poly] = i;
    poly = (poly << 1) ^ poly;
    if (poly & 0x100) poly ^= 0x11b;
  }
}

function interpolate(shares: RawShare[], x: number): Uint8Array {
  const xs = new Set(shares.map((s) => s.x));
  if (xs.size !== shares.length) throw new LuthenError("DUPLICATE_SHARE", "Share indices must be unique");
  const length = shares[0]!.value.length;
  if (shares.some((s) => s.value.length !== length)) {
    throw new LuthenError("MIXED_SETS", "All share values must have the same length");
  }
  const hit = shares.find((s) => s.x === x);
  if (hit) return hit.value.slice();

  let logProd = 0;
  for (const s of shares) logProd += LOG[s.x ^ x]!;

  const result = new Uint8Array(length);
  for (const s of shares) {
    let logDenominator = LOG[s.x ^ x]!;
    for (const o of shares) if (o.x !== s.x) logDenominator += LOG[s.x ^ o.x]!;
    const logBasis = (((logProd - logDenominator) % 255) + 255) % 255;
    for (let i = 0; i < length; i++) {
      const v = s.value[i]!;
      if (v !== 0) result[i]! ^= EXP[(LOG[v]! + logBasis) % 255]!;
    }
  }
  return result;
}

function createDigest(randomPart: Uint8Array, secret: Uint8Array): Uint8Array {
  return hmac(sha256, randomPart, secret).slice(0, DIGEST_LENGTH);
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Split `secret` into `count` shares (x = 0..count-1), any `threshold` of which recover it. */
export function splitSecret(threshold: number, count: number, secret: Uint8Array): RawShare[] {
  if (threshold < 1 || threshold > count || count > MAX_SHARE_COUNT) {
    throw new LuthenError("BAD_SCHEME", `Invalid sharing: ${threshold} of ${count}`);
  }
  if (threshold === 1) return Array.from({ length: count }, (_, x) => ({ x, value: secret.slice() }));

  const randomShareCount = threshold - 2;
  const shares: RawShare[] = Array.from({ length: randomShareCount }, (_, x) => ({
    x,
    value: randomBytes(secret.length),
  }));
  const randomPart = randomBytes(secret.length - DIGEST_LENGTH);
  const digestShare = new Uint8Array(secret.length);
  digestShare.set(createDigest(randomPart, secret));
  digestShare.set(randomPart, DIGEST_LENGTH);
  const base = [...shares, { x: DIGEST_INDEX, value: digestShare }, { x: SECRET_INDEX, value: secret }];
  for (let x = randomShareCount; x < count; x++) shares.push({ x, value: interpolate(base, x) });
  return shares;
}

/** Recover the secret from exactly `threshold` shares, verifying the digest. */
export function recoverSecret(threshold: number, shares: RawShare[]): Uint8Array {
  if (threshold === 1) return shares[0]!.value.slice();
  const secret = interpolate(shares, SECRET_INDEX);
  const digestShare = interpolate(shares, DIGEST_INDEX);
  const digest = digestShare.subarray(0, DIGEST_LENGTH);
  const randomPart = digestShare.subarray(DIGEST_LENGTH);
  if (!bytesEqual(digest, createDigest(randomPart, secret))) {
    throw new LuthenError("INVALID_SHARE", "Invalid digest of the shared secret: shares are corrupt or inconsistent");
  }
  return secret;
}
