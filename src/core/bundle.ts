import { renderRecovery, renderWordlist } from "./recovery";
import { totalShares, type Scheme } from "./scheme";
import { renderShareFile } from "./sharefile";
import type { Sealed } from "./vault";

export const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Share label -> file name -> contents. */
export type BundleFiles = Record<string, Record<string, Uint8Array | string>>;

/** `flatThreshold` is given only for a flat "any M of N" scheme. */
export function summarizeScheme(scheme: Scheme, flatThreshold?: number): string {
  if (flatThreshold !== undefined) return `any ${flatThreshold} of ${totalShares(scheme)} shares`;
  const parts = scheme.groups.map((g, i) => `group ${i + 1} needs ${g.threshold} of ${g.count}`);
  return `${scheme.groupThreshold} of ${scheme.groups.length} groups; ${parts.join(", ")}`;
}

export function defaultLabels(scheme: Scheme, flat: boolean): string[] {
  if (flat) return Array.from({ length: totalShares(scheme) }, (_, i) => `share-${i + 1}`);
  return scheme.groups.flatMap((g, gi) =>
    Array.from({ length: g.count }, (_, mi) => `group-${gi + 1}-share-${mi + 1}`),
  );
}

/** Returns what is wrong with the labels (worded without a flag name), or undefined if they are fine. */
export function checkLabels(labels: string[], total: number): string | undefined {
  if (labels.length !== total) return `needs exactly ${total} names, got ${labels.length}`;
  if (!labels.every((n) => NAME_RE.test(n))) return "may only use letters, digits, '.', '_' and '-'";
  if (new Set(labels).size !== total) return "must be unique";
  return undefined;
}

export interface BundleOptions {
  sealed: Sealed;
  labels: string[];
  name: string;
  schemeSummary: string;
  created: Date;
  version: string;
}

export function bundleFiles(o: BundleOptions): BundleFiles {
  const fileName = `${o.name}.age`;
  const recovery = renderRecovery({
    fileName,
    schemeSummary: o.schemeSummary,
    identifier: o.sealed.identifier,
    version: o.version,
  });
  const wordlist = renderWordlist();
  const files: BundleFiles = {};
  o.sealed.shares.forEach((s, i) => {
    const label = o.labels[i]!;
    files[label] = {
      "share.txt": renderShareFile({
        label,
        position: s.position,
        identifier: o.sealed.identifier,
        fileName,
        created: o.created,
        mnemonic: s.mnemonic,
      }),
      "RECOVERY.md": recovery,
      [fileName]: o.sealed.ciphertext,
      "slip39-wordlist.txt": wordlist,
    };
  });
  return files;
}
