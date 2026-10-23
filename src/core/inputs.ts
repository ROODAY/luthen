import { LuthenError } from "./errors";
import { normalizeShareInput } from "./sharefile";
import { progress } from "./vault";
import { isZip, unzipFiles } from "./zip";

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export interface Problem {
  name: string;
  message: string;
}

export interface LoadedShare {
  mnemonic: string;
  source: string;
}

export interface InputState {
  ciphertext?: InputFile;
  shares: LoadedShare[];
  problems: Problem[];
}

export const EMPTY_INPUTS: InputState = { shares: [], problems: [] };

const AGE_MAGIC = new TextEncoder().encode("age-encryption.org/v1\n");
// Bundle files that are never shares; skipped silently whether loose or zipped (RECOVERY.md tells holders to drop in the whole folder).
const BUNDLE_FURNITURE = new Set(["RECOVERY.md", "slip39-wordlist.txt"]);

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

function isAge(bytes: Uint8Array): boolean {
  return bytes.length >= AGE_MAGIC.length && AGE_MAGIC.every((b, i) => bytes[i] === b);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Working copy that classification mutates; `addFiles` and `addShareText` hand out a fresh one each call. */
function copy(state: InputState): InputState {
  return { ciphertext: state.ciphertext, shares: [...state.shares], problems: [...state.problems] };
}

/** `onNotShare`: "skip" for zip entries, "generic" for loose files, "detail" to report the parse error (typed text). */
function addShare(s: InputState, text: string, source: string, onNotShare: "skip" | "generic" | "detail"): void {
  let mnemonic: string;
  try {
    mnemonic = normalizeShareInput(text);
  } catch (e) {
    if (!(e instanceof LuthenError)) throw e;
    // Inside a zip, files that are not shares are just bundle furniture.
    if (onNotShare === "generic") s.problems.push({ name: source, message: "not a Luthen share or encrypted file" });
    else if (onNotShare === "detail") s.problems.push({ name: source, message: e.message });
    return;
  }
  if (s.shares.some((x) => x.mnemonic === mnemonic)) return;
  try {
    progress([...s.shares.map((x) => x.mnemonic), mnemonic]);
  } catch (e) {
    if (!(e instanceof LuthenError)) throw e;
    s.problems.push({ name: source, message: e.message });
    return;
  }
  s.shares.push({ mnemonic, source });
}

function classify(s: InputState, name: string, bytes: Uint8Array, depth: number, inZip: boolean): void {
  if (isZip(bytes)) {
    if (depth >= 2) return;
    let entries: ReturnType<typeof unzipFiles>;
    try {
      entries = unzipFiles(bytes);
    } catch {
      s.problems.push({ name, message: "could not read zip" });
      return;
    }
    for (const entry of entries) {
      const segments = entry.path.split("/");
      const base = segments[segments.length - 1]!;
      if (segments.includes("__MACOSX") || base.startsWith("._")) continue;
      classify(s, `${name}/${entry.path}`, entry.bytes, depth + 1, true);
    }
    return;
  }
  if (isAge(bytes)) {
    if (!s.ciphertext) s.ciphertext = { name: basename(name), bytes };
    else if (!sameBytes(s.ciphertext.bytes, bytes)) {
      s.problems.push({
        name,
        message: `a different encrypted file (${s.ciphertext.name}) is already loaded; clear it first`,
      });
    }
    return;
  }
  if (BUNDLE_FURNITURE.has(basename(name))) return;
  addShare(s, decodeText(bytes), name, inZip ? "skip" : "generic");
}

export function addFiles(state: InputState, files: InputFile[]): InputState {
  const next = copy(state);
  for (const f of files) classify(next, f.name, f.bytes, 0, false);
  return next;
}

export function addShareText(state: InputState, text: string, source: string): InputState {
  const next = copy(state);
  addShare(next, text, source, "detail");
  return next;
}

/** The name to save recovered contents under: the ciphertext's name without `.age`. */
export function outputName(ciphertextName: string): string {
  const base = basename(ciphertextName);
  if (!base.endsWith(".age")) return "luthen-output";
  return base.slice(0, -4) || "luthen-output";
}
