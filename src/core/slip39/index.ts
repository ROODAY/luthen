import { LuthenError } from "../errors";
import { decrypt, encrypt } from "./cipher";
import { decodeMnemonic, encodeMnemonic, type Share } from "./mnemonic";
import { MAX_SHARE_COUNT, recoverSecret, splitSecret, type RawShare } from "./shamir";

export interface GroupSpec {
  threshold: number;
  count: number;
}

const MIN_SECRET_BYTES = 16;
const MAX_ITERATION_EXPONENT = 15;

function badScheme(message: string): never {
  throw new LuthenError("BAD_SCHEME", message);
}

function randomIdentifier(): number {
  const b = crypto.getRandomValues(new Uint8Array(2));
  return ((b[0]! << 8) | b[1]!) & 0x7fff;
}

/**
 * Split `masterSecret` into SLIP-39 mnemonics: `groupThreshold` of the `groups` are needed,
 * and within each group `threshold` of its `count` members. Returns mnemonics as [group][member].
 * Shares use the extendable (current) format.
 */
export function generateMnemonics(
  groupThreshold: number,
  groups: GroupSpec[],
  masterSecret: Uint8Array,
  passphrase = "",
  iterationExponent = 1,
): string[][] {
  if (masterSecret.length < MIN_SECRET_BYTES || masterSecret.length % 2 !== 0) {
    badScheme(`Master secret must be at least ${MIN_SECRET_BYTES} bytes and an even length, got ${masterSecret.length}`);
  }
  if (!Number.isInteger(iterationExponent) || iterationExponent < 0 || iterationExponent > MAX_ITERATION_EXPONENT) {
    badScheme(`Iteration exponent must be an integer from 0 to ${MAX_ITERATION_EXPONENT}`);
  }
  if (!/^[\x20-\x7e]*$/.test(passphrase)) badScheme("Passphrase must contain only printable ASCII characters");
  if (groups.length < 1 || groups.length > MAX_SHARE_COUNT) {
    badScheme(`Group count must be from 1 to ${MAX_SHARE_COUNT}, got ${groups.length}`);
  }
  if (!Number.isInteger(groupThreshold) || groupThreshold < 1 || groupThreshold > groups.length) {
    badScheme(`Group threshold must be from 1 to the number of groups (${groups.length}), got ${groupThreshold}`);
  }
  for (const [i, { threshold, count }] of groups.entries()) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_SHARE_COUNT) {
      badScheme(`Group ${i + 1}: member count must be from 1 to ${MAX_SHARE_COUNT}, got ${count}`);
    }
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > count) {
      badScheme(`Group ${i + 1}: member threshold must be from 1 to ${count}, got ${threshold}`);
    }
    if (threshold === 1 && count > 1) {
      badScheme(`Group ${i + 1}: a member threshold of 1 requires a 1-of-1 group (got 1 of ${count})`);
    }
  }

  const identifier = randomIdentifier();
  const extendable = true;
  const encrypted = encrypt(masterSecret, passphrase, iterationExponent, identifier, extendable);
  const groupShares = splitSecret(groupThreshold, groups.length, encrypted);

  return groups.map(({ threshold, count }, g) =>
    splitSecret(threshold, count, groupShares[g]!.value).map(({ x, value }) =>
      encodeMnemonic({
        identifier,
        extendable,
        iterationExponent,
        groupIndex: g,
        groupThreshold,
        groupCount: groups.length,
        memberIndex: x,
        memberThreshold: threshold,
        value,
      }),
    ),
  );
}

/** True when two shares belong to the same split (identifier, parameters and length agree). */
export function sameSet(a: Share, b: Share): boolean {
  return (
    a.identifier === b.identifier &&
    a.extendable === b.extendable &&
    a.iterationExponent === b.iterationExponent &&
    a.groupThreshold === b.groupThreshold &&
    a.groupCount === b.groupCount &&
    a.value.length === b.value.length
  );
}

/**
 * Recover the master secret from SLIP-39 mnemonics. Shares beyond what is needed are ignored:
 * only groups holding at least their member threshold count, and the first `threshold` shares
 * of each such group (and the first `groupThreshold` such groups) are used.
 * Surplus shares beyond the thresholds are ignored; use vault.verify to check every share.
 */
export function combineMnemonics(mnemonics: string[], passphrase = ""): Uint8Array {
  const shares = mnemonics.map(decodeMnemonic);
  const first = shares[0];
  if (!first) throw new LuthenError("NOT_ENOUGH_SHARES", "No shares were provided");

  const groups = new Map<number, Share[]>();
  for (const share of shares) {
    if (!sameSet(first, share)) {
      throw new LuthenError(
        "MIXED_SETS",
        `Shares belong to different sets (identifier ${first.identifier} vs ${share.identifier}): ` +
          "all shares must share the same identifier, iteration exponent, group threshold, group count and length",
      );
    }
    const group = groups.get(share.groupIndex) ?? [];
    const peer = group[0];
    if (peer && peer.memberThreshold !== share.memberThreshold) {
      throw new LuthenError(
        "MIXED_SETS",
        `Shares in group ${share.groupIndex + 1} disagree on the member threshold ` +
          `(${peer.memberThreshold} vs ${share.memberThreshold}; identifier ${first.identifier})`,
      );
    }
    if (group.some((s) => s.memberIndex === share.memberIndex)) {
      throw new LuthenError(
        "DUPLICATE_SHARE",
        `Share ${share.memberIndex + 1} of group ${share.groupIndex + 1} was provided more than once`,
      );
    }
    group.push(share);
    groups.set(share.groupIndex, group);
  }

  const complete = [...groups.entries()].filter(([, g]) => g.length >= g[0]!.memberThreshold);
  if (complete.length < first.groupThreshold) {
    const detail = [...groups.entries()]
      .map(([i, g]) => `group ${i + 1}: ${g.length} of ${g[0]!.memberThreshold}`)
      .join(", ");
    throw new LuthenError(
      "NOT_ENOUGH_SHARES",
      `Not enough shares: need ${first.groupThreshold} complete group(s), have ${complete.length} (${detail})`,
    );
  }

  const groupShares: RawShare[] = complete.slice(0, first.groupThreshold).map(([groupIndex, g]) => {
    const threshold = g[0]!.memberThreshold;
    const members = g.slice(0, threshold).map((s) => ({ x: s.memberIndex, value: s.value }));
    return { x: groupIndex, value: recoverSecret(threshold, members) };
  });
  const encrypted = recoverSecret(first.groupThreshold, groupShares);
  return decrypt(encrypted, passphrase, first.iterationExponent, first.identifier, first.extendable);
}
