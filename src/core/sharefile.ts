import { LuthenError } from "./errors";
import { indicesToMnemonic, mnemonicToIndices } from "./slip39/mnemonic";
import { WORDLIST } from "./slip39/wordlist";

export interface ShareFileInfo {
  label: string;
  position: string;
  identifier: number;
  fileName: string;
  created: Date;
  mnemonic: string;
}

const ROWS = 11;
const COLUMNS = 3;
const WORDS_BEGIN = "-----BEGIN SLIP-39 WORDS-----";
const WORDS_END = "-----END SLIP-39 WORDS-----";
const INDICES_BEGIN = "-----BEGIN SLIP-39 WORD INDICES-----";
const INDICES_END = "-----END SLIP-39 WORD INDICES-----";

export function renderShareFile(info: ShareFileInfo): string {
  const words = info.mnemonic.split(" ");
  const indices = mnemonicToIndices(info.mnemonic);
  const wordLines: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    const cells: string[] = [];
    for (let c = 0; c < COLUMNS; c++) {
      const n = r + ROWS * c;
      if (n < words.length) cells.push(`${String(n + 1).padStart(2)} ${words[n]!.padEnd(10)}`);
    }
    wordLines.push(cells.join(" ").trimEnd());
  }
  const indexLines: string[] = [];
  for (let i = 0; i < indices.length; i += ROWS) indexLines.push(indices.slice(i, i + ROWS).join(" "));
  return [
    "LUTHEN SHARE · format v1 · SLIP-39 + age (passphrase)",
    `Label:    ${info.label}`,
    `Position: ${info.position}`,
    `Set ID:   ${info.identifier}`,
    `File:     ${info.fileName}`,
    `Created:  ${info.created.toISOString().slice(0, 10)}`,
    "",
    WORDS_BEGIN,
    ...wordLines,
    WORDS_END,
    "",
    INDICES_BEGIN,
    ...indexLines,
    INDICES_END,
    "",
    "Keep this private. See RECOVERY.md for how to recover.",
    "",
  ].join("\n");
}

const WORD_INDEX = new Map<string, number>(WORDLIST.map((w, i) => [w, i]));

function between(text: string, begin: string, end: string): string | undefined {
  const b = text.indexOf(begin);
  if (b < 0) return undefined;
  const e = text.indexOf(end, b + begin.length);
  if (e < 0) return undefined;
  return text.slice(b + begin.length, e);
}

function tokens(text: string): string[] {
  return text.split(/[\s,]+/).filter((t) => t.length > 0);
}

function invalid(message: string): LuthenError {
  return new LuthenError("INVALID_SHARE", message);
}

/** Parse a block of words (optionally numbered) or bare indices into word indices. */
function parseToIndices(text: string): number[] {
  const toks = tokens(text).map((t) => t.toLowerCase());
  if (toks.length === 0) throw invalid("no share words found");
  const isNumber = (t: string) => /^\d+$/.test(t);
  if (toks.every(isNumber)) {
    return toks.map((t, i) => {
      const n = Number(t);
      if (n > 1023) throw invalid(`word index ${t} at position ${i + 1} is out of range (0-1023)`);
      return n;
    });
  }
  const out: number[] = [];
  for (const t of toks) {
    if (/^\d+[.)]?$/.test(t)) continue; // list numbering
    const word = t.replace(/^[(\[]+|[.,;:)\]]+$/g, "");
    const idx = WORD_INDEX.get(word);
    if (idx === undefined) throw invalid(`unknown word "${word}" at word ${out.length + 1}`);
    out.push(idx);
  }
  if (out.length === 0) throw invalid("no share words found");
  return out;
}

/** The share.txt words block is laid out in columns; restore reading order using its position numbers. */
function orderByNumber(block: string): string {
  const toks = tokens(block);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < toks.length; i += 2) {
    if (!/^\d+$/.test(toks[i]!)) return block;
    pairs.push([Number(toks[i]), toks[i + 1]!]);
  }
  if (toks.length % 2 !== 0) return block;
  return pairs.sort((a, b) => a[0] - b[0]).map(([, w]) => w).join(" ");
}

/** Accepts share.txt content, bare words, a numbered list, or word indices; returns the canonical mnemonic. */
export function normalizeShareInput(text: string): string {
  const wordsBlock = between(text, WORDS_BEGIN, WORDS_END);
  if (wordsBlock === undefined) return indicesToMnemonic(parseToIndices(text));
  const fromWords = parseToIndices(orderByNumber(wordsBlock));
  const indicesBlock = between(text, INDICES_BEGIN, INDICES_END);
  if (indicesBlock !== undefined) {
    const fromIndices = parseToIndices(indicesBlock);
    if (fromIndices.length !== fromWords.length || fromIndices.some((v, i) => v !== fromWords[i])) {
      throw invalid("the words and word indices in this share file disagree");
    }
  }
  return indicesToMnemonic(fromWords);
}
