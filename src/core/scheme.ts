import { LuthenError } from "./errors";
import type { GroupSpec } from "./slip39/index";

export interface Scheme {
  groupThreshold: number;
  groups: GroupSpec[];
}

const MAX = 16;

/** A plain "any `threshold` of `shares`" scheme. Threshold 1 uses N independent 1-of-1 groups. */
export function flat(threshold: number, shares: number): Scheme {
  if (threshold === 1) {
    return { groupThreshold: 1, groups: Array.from({ length: shares }, () => ({ threshold: 1, count: 1 })) };
  }
  return { groupThreshold: 1, groups: [{ threshold, count: shares }] };
}

function bad(message: string): never {
  throw new LuthenError("BAD_SCHEME", message);
}

export function validateScheme(s: Scheme): void {
  const n = s.groups.length;
  if (n < 1 || n > MAX) bad(`A scheme needs between 1 and ${MAX} groups, got ${n}.`);
  if (!Number.isInteger(s.groupThreshold) || s.groupThreshold < 1 || s.groupThreshold > n) {
    bad(`The number of groups required must be between 1 and ${n}, got ${s.groupThreshold}.`);
  }
  s.groups.forEach(({ threshold, count }, i) => {
    const label = n === 1 ? "The scheme" : `Group ${i + 1}`;
    if (!Number.isInteger(count) || count < 1 || count > MAX) {
      bad(`${label} needs between 1 and ${MAX} shares, got ${count}.`);
    }
    if (!Number.isInteger(threshold) || threshold < 1) {
      bad(`${label}: the number of shares needed must be at least 1, got ${threshold}.`);
    }
    if (threshold > count) bad(`${label}: ${threshold} shares needed but only ${count} would exist.`);
    if (threshold === 1 && count > 1) {
      bad(`${label}: needing just 1 of ${count} shares is not supported; use ${count} separate groups of 1 instead.`);
    }
  });
}

export function totalShares(s: Scheme): number {
  return s.groups.reduce((sum, g) => sum + g.count, 0);
}

export function describePosition(s: Scheme, group: number, member: number): string {
  const only = s.groups[0];
  if (s.groups.length === 1 && only) {
    return `Share ${member + 1} of ${only.count} · any ${only.threshold} needed`;
  }
  if (s.groups.every((g) => g.threshold === 1 && g.count === 1)) {
    return `Share ${group + 1} of ${s.groups.length} · any ${s.groupThreshold} needed`;
  }
  const g = s.groups[group]!;
  return (
    `Group ${group + 1}, member ${member + 1} of ${g.count} · ` +
    `${g.threshold} of ${g.count} needed from this group · ${s.groupThreshold} of ${s.groups.length} groups needed`
  );
}
