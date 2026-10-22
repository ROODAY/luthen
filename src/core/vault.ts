import { Decrypter, Encrypter } from "age-encryption";
import { LuthenError } from "./errors";
import { describePosition, validateScheme, type Scheme } from "./scheme";
import { combineMnemonics, generateMnemonics, sameSet } from "./slip39/index";
import { decodeMnemonic, type Share } from "./slip39/mnemonic";

export interface SealedShare {
  group: number;
  member: number;
  mnemonic: string;
  position: string;
}

export interface Sealed {
  ciphertext: Uint8Array;
  identifier: number;
  scheme: Scheme;
  shares: SealedShare[];
}

export interface Progress {
  identifier: number;
  groupThreshold: number;
  groups: { index: number; threshold: number; have: number }[];
  complete: boolean;
}

export interface RotationGroup {
  index: number;
  threshold: number;
  /** Member indices available in this group. */
  members: number[];
}

export interface Pick {
  group: number;
  member: number;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Threshold-sized subsets such that every member of every given group appears in at least one.
 * For each group and each member offset, one subset is built: that group's members starting at
 * the offset, plus the next `groupThreshold - 1` groups (wrapping) at the same offset.
 * Requires groupThreshold <= groups.length and threshold <= members.length per group.
 */
export function rotationSubsets(groups: RotationGroup[], groupThreshold: number): Pick[][] {
  const k = groups.length;
  const subsets: Pick[][] = [];
  for (let gi = 0; gi < k; gi++) {
    for (let o = 0; o < groups[gi]!.members.length; o++) {
      const subset: Pick[] = [];
      for (let j = 0; j < groupThreshold; j++) {
        const g = groups[(gi + j) % k]!;
        for (let m = 0; m < g.threshold; m++) {
          subset.push({ group: g.index, member: g.members[(o + m) % g.members.length]! });
        }
      }
      subsets.push(subset);
    }
  }
  return subsets;
}

async function ageDecrypt(ciphertext: Uint8Array, secret: Uint8Array): Promise<Uint8Array> {
  const d = new Decrypter();
  d.addPassphrase(toHex(secret));
  try {
    return await d.decrypt(ciphertext);
  } catch {
    throw new LuthenError(
      "DECRYPT_FAILED",
      "Could not decrypt: the shares do not match this file, or the file is damaged",
    );
  }
}

export async function seal(
  plaintext: Uint8Array,
  scheme: Scheme,
  opts: { scryptWorkFactor?: number } = {},
): Promise<Sealed> {
  validateScheme(scheme);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  try {
    const e = new Encrypter();
    e.setPassphrase(toHex(secret));
    if (opts.scryptWorkFactor !== undefined) e.setScryptWorkFactor(opts.scryptWorkFactor);
    const ciphertext = await e.encrypt(plaintext);

    const mnemonics = generateMnemonics(scheme.groupThreshold, scheme.groups, secret);

    // Self-check: every share must take part in a subset that recovers the secret.
    const rot = scheme.groups.map((g, index) => ({
      index,
      threshold: g.threshold,
      members: Array.from({ length: g.count }, (_, i) => i),
    }));
    for (const subset of rotationSubsets(rot, scheme.groupThreshold)) {
      const recovered = combineMnemonics(subset.map((p) => mnemonics[p.group]![p.member]!));
      const ok = equalBytes(recovered, secret);
      recovered.fill(0);
      if (!ok) throw new Error("self-check failed");
    }
    const d = new Decrypter();
    d.addPassphrase(toHex(secret));
    if (!equalBytes(await d.decrypt(ciphertext), plaintext)) throw new Error("self-check failed");

    const shares: SealedShare[] = mnemonics.flatMap((row, group) =>
      row.map((mnemonic, member) => ({ group, member, mnemonic, position: describePosition(scheme, group, member) })),
    );
    return { ciphertext, identifier: decodeMnemonic(shares[0]!.mnemonic).identifier, scheme, shares };
  } finally {
    secret.fill(0);
  }
}

export async function open(ciphertext: Uint8Array, mnemonics: string[]): Promise<Uint8Array> {
  const secret = combineMnemonics(mnemonics);
  try {
    return await ageDecrypt(ciphertext, secret);
  } finally {
    secret.fill(0);
  }
}

type Entry = { share: Share; mnemonic: string };

function analyze(mnemonics: string[]): { progress: Progress; byGroup: Map<number, Entry[]> } {
  const decoded = mnemonics.map((mnemonic) => ({ share: decodeMnemonic(mnemonic), mnemonic }));
  const first = decoded[0]?.share;
  if (!first) throw new LuthenError("NOT_ENOUGH_SHARES", "No shares were provided");
  const byGroup = new Map<number, Entry[]>();
  for (const entry of decoded) {
    const { share } = entry;
    if (!sameSet(first, share)) {
      throw new LuthenError(
        "MIXED_SETS",
        `Shares belong to different sets (identifier ${first.identifier} vs ${share.identifier})`,
      );
    }
    const list = byGroup.get(share.groupIndex) ?? [];
    if (list[0] && list[0].share.memberThreshold !== share.memberThreshold) {
      throw new LuthenError("MIXED_SETS", `Shares in group ${share.groupIndex + 1} disagree on the member threshold`);
    }
    if (list.some((e) => e.share.memberIndex === share.memberIndex)) {
      throw new LuthenError(
        "DUPLICATE_SHARE",
        `Share ${share.memberIndex + 1} of group ${share.groupIndex + 1} was provided more than once`,
      );
    }
    list.push(entry);
    byGroup.set(share.groupIndex, list);
  }
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, list]) => ({ index, threshold: list[0]!.share.memberThreshold, have: list.length }));
  const complete = groups.filter((g) => g.have >= g.threshold).length >= first.groupThreshold;
  return { progress: { identifier: first.identifier, groupThreshold: first.groupThreshold, groups, complete }, byGroup };
}

export function progress(mnemonics: string[]): Progress {
  return analyze(mnemonics).progress;
}

/**
 * Report progress; once the thresholds are met, prove that every share in a complete group
 * takes part in a subset recovering the same secret, then decrypt once in memory and discard.
 * Shares in groups that are still incomplete cannot be checked and are only counted.
 */
export async function verify(ciphertext: Uint8Array, mnemonics: string[]): Promise<Progress> {
  const { progress: p, byGroup } = analyze(mnemonics);
  if (!p.complete) return p;

  const eligible: RotationGroup[] = p.groups
    .filter((g) => g.have >= g.threshold)
    .map((g) => ({
      index: g.index,
      threshold: g.threshold,
      members: byGroup.get(g.index)!.map((e) => e.share.memberIndex),
    }));
  const mnemonicOf = (pick: Pick): string =>
    byGroup.get(pick.group)!.find((e) => e.share.memberIndex === pick.member)!.mnemonic;

  let reference: Uint8Array | undefined;
  try {
    for (const subset of rotationSubsets(eligible, p.groupThreshold)) {
      const secret = combineMnemonics(subset.map(mnemonicOf));
      if (!reference) {
        reference = secret;
      } else {
        const same = equalBytes(reference, secret);
        secret.fill(0);
        if (!same) throw new LuthenError("INVALID_SHARE", "The supplied shares disagree: at least one share is wrong or corrupted");
      }
    }
    await ageDecrypt(ciphertext, reference!);
  } finally {
    reference?.fill(0);
  }
  return p;
}
