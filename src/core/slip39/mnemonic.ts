import { LuthenError } from "../errors";
import { WORDLIST } from "./wordlist";

export interface Share {
  identifier: number;
  extendable: boolean;
  iterationExponent: number;
  groupIndex: number;
  groupThreshold: number;
  groupCount: number;
  memberIndex: number;
  memberThreshold: number;
  value: Uint8Array;
}

const RADIX_BITS = 10;
const ID_EXP_WORDS = 2;
const CHECKSUM_WORDS = 3;
const METADATA_WORDS = ID_EXP_WORDS + 2 + CHECKSUM_WORDS;
const MIN_MNEMONIC_WORDS = METADATA_WORDS + 13; // 128-bit minimum secret

const WORD_INDEX = new Map<string, number>(WORDLIST.map((w, i) => [w, i]));

const GEN = [
  0xe0e040, 0x1c1c080, 0x3838100, 0x7070200, 0xe0e0009, 0x1c0c2412, 0x38086c24, 0x3090fc48,
  0x21b1f890, 0x3f3f120,
];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 20;
    chk = (((chk & 0xfffff) << 10) ^ v) >>> 0;
    for (let i = 0; i < 10; i++) if ((b >>> i) & 1) chk = (chk ^ GEN[i]!) >>> 0;
  }
  return chk;
}

function customization(extendable: boolean): number[] {
  return Array.from(new TextEncoder().encode(extendable ? "shamir_extendable" : "shamir"));
}

function createChecksum(data: number[], extendable: boolean): number[] {
  const pm = (polymod([...customization(extendable), ...data, 0, 0, 0]) ^ 1) >>> 0;
  return [2, 1, 0].map((i) => (pm >>> (10 * i)) & 1023);
}

function intToIndices(value: bigint, length: number): number[] {
  const out: number[] = [];
  for (let i = length - 1; i >= 0; i--) out.push(Number((value >> BigInt(i * RADIX_BITS)) & 1023n));
  return out;
}

function indicesToInt(indices: number[]): bigint {
  let v = 0n;
  for (const i of indices) v = (v << 10n) | BigInt(i);
  return v;
}

export function mnemonicToIndices(mnemonic: string): number[] {
  const words = mnemonic.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  return words.map((w) => {
    const i = WORD_INDEX.get(w);
    if (i === undefined) throw new LuthenError("INVALID_SHARE", `Unknown word in share: "${w}"`);
    return i;
  });
}

export function indicesToMnemonic(indices: number[]): string {
  return indices
    .map((i) => {
      const w = WORDLIST[i];
      if (w === undefined) throw new LuthenError("INVALID_SHARE", `Word index out of range: ${i}`);
      return w;
    })
    .join(" ");
}

export function encodeMnemonic(share: Share): string {
  const idExp =
    (BigInt(share.identifier) << 5n) |
    (BigInt(share.extendable ? 1 : 0) << 4n) |
    BigInt(share.iterationExponent);
  let params = BigInt(share.groupIndex);
  for (const nibble of [
    share.groupThreshold - 1,
    share.groupCount - 1,
    share.memberIndex,
    share.memberThreshold - 1,
  ]) {
    params = (params << 4n) | BigInt(nibble);
  }

  let valueInt = 0n;
  for (const b of share.value) valueInt = (valueInt << 8n) | BigInt(b);
  const valueWords = Math.ceil((share.value.length * 8) / RADIX_BITS);

  const data = [
    ...intToIndices(idExp, ID_EXP_WORDS),
    ...intToIndices(params, 2),
    ...intToIndices(valueInt, valueWords),
  ];
  return indicesToMnemonic([...data, ...createChecksum(data, share.extendable)]);
}

export function decodeMnemonic(mnemonic: string): Share {
  const data = mnemonicToIndices(mnemonic);
  if (data.length < MIN_MNEMONIC_WORDS) {
    throw new LuthenError(
      "INVALID_SHARE",
      `Invalid mnemonic length: at least ${MIN_MNEMONIC_WORDS} words required, got ${data.length}`,
    );
  }
  const paddingBits = (RADIX_BITS * (data.length - METADATA_WORDS)) % 16;
  if (paddingBits > 8) throw new LuthenError("INVALID_SHARE", "Invalid mnemonic length");

  const idExp = Number(indicesToInt(data.slice(0, ID_EXP_WORDS)));
  const extendable = ((idExp >>> 4) & 1) === 1;
  if (polymod([...customization(extendable), ...data]) !== 1) {
    throw new LuthenError("INVALID_SHARE", "Invalid mnemonic checksum");
  }

  const params = Number(indicesToInt(data.slice(ID_EXP_WORDS, ID_EXP_WORDS + 2)));
  const groupIndex = (params >>> 16) & 15;
  const groupThreshold = ((params >>> 12) & 15) + 1;
  const groupCount = ((params >>> 8) & 15) + 1;
  const memberIndex = (params >>> 4) & 15;
  const memberThreshold = (params & 15) + 1;
  if (groupCount < groupThreshold) {
    throw new LuthenError("INVALID_SHARE", "Group threshold cannot be greater than group count");
  }

  const valueWords = data.slice(ID_EXP_WORDS + 2, data.length - CHECKSUM_WORDS);
  const byteCount = Math.ceil((RADIX_BITS * valueWords.length - paddingBits) / 8);
  let valueInt = indicesToInt(valueWords);
  if (valueInt >> BigInt(byteCount * 8) !== 0n) {
    throw new LuthenError("INVALID_SHARE", "Invalid mnemonic padding");
  }
  const value = new Uint8Array(byteCount);
  for (let i = byteCount - 1; i >= 0; i--) {
    value[i] = Number(valueInt & 255n);
    valueInt >>= 8n;
  }

  return {
    identifier: idExp >>> 5,
    extendable,
    iterationExponent: idExp & 15,
    groupIndex,
    groupThreshold,
    groupCount,
    memberIndex,
    memberThreshold,
    value,
  };
}
