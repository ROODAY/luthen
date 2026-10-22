import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

// Master secret encryption: 4-round Feistel network keyed with PBKDF2-HMAC-SHA256,
// per SLIP-39 and the reference implementation (cipher.py).

const BASE_ITERATION_COUNT = 10000;
const ROUND_COUNT = 4;

function salt(identifier: number, extendable: boolean): Uint8Array {
  if (extendable) return new Uint8Array(0);
  const prefix = new TextEncoder().encode("shamir");
  const out = new Uint8Array(prefix.length + 2);
  out.set(prefix);
  out[prefix.length] = (identifier >>> 8) & 0xff;
  out[prefix.length + 1] = identifier & 0xff;
  return out;
}

function roundFunction(
  round: number,
  passphrase: Uint8Array,
  iterationExponent: number,
  saltPrefix: Uint8Array,
  r: Uint8Array,
): Uint8Array {
  const password = new Uint8Array(1 + passphrase.length);
  password[0] = round;
  password.set(passphrase, 1);
  const s = new Uint8Array(saltPrefix.length + r.length);
  s.set(saltPrefix);
  s.set(r, saltPrefix.length);
  return pbkdf2(sha256, password, s, {
    c: (BASE_ITERATION_COUNT << iterationExponent) / ROUND_COUNT,
    dkLen: r.length,
  });
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((v, i) => v ^ b[i]!);
}

function feistel(
  input: Uint8Array,
  passphrase: string,
  iterationExponent: number,
  identifier: number,
  extendable: boolean,
  rounds: number[],
): Uint8Array {
  const half = input.length / 2;
  let l: Uint8Array = input.slice(0, half);
  let r: Uint8Array = input.slice(half);
  const p = new TextEncoder().encode(passphrase);
  const s = salt(identifier, extendable);
  for (const i of rounds) [l, r] = [r, xor(l, roundFunction(i, p, iterationExponent, s, r))];
  const out = new Uint8Array(input.length);
  out.set(r);
  out.set(l, half);
  return out;
}

const FORWARD = [0, 1, 2, 3];
const BACKWARD = [3, 2, 1, 0];

/** Callers guarantee an even-length secret. */
export function encrypt(
  masterSecret: Uint8Array,
  passphrase: string,
  iterationExponent: number,
  identifier: number,
  extendable: boolean,
): Uint8Array {
  return feistel(masterSecret, passphrase, iterationExponent, identifier, extendable, FORWARD);
}

/** Callers guarantee an even-length ciphertext. */
export function decrypt(
  encryptedSecret: Uint8Array,
  passphrase: string,
  iterationExponent: number,
  identifier: number,
  extendable: boolean,
): Uint8Array {
  return feistel(encryptedSecret, passphrase, iterationExponent, identifier, extendable, BACKWARD);
}
