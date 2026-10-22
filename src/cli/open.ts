import { parseArgs } from "node:util";
import { basename } from "node:path";
import { LuthenError } from "../core/errors";
import { normalizeShareInput } from "../core/sharefile";
import { open, progress, verify, type Progress } from "../core/vault";
import { unlinkSync } from "node:fs";
import { pathExists, prompt, readInput, writeExclusive } from "./io";
import { UsageError } from "./seal";

export const OPEN_USAGE = `Usage:
  luthen open <file.age> [share.txt ...] [-o <path>|-]

Pass share.txt files as arguments. Any other shares are asked for at the prompt: type one share per
line (words or numbers).
-o - writes the plaintext to stdout; -o <path> refuses to overwrite an existing file.
Without -o, asks for an output path (needs a terminal).
`;

export const VERIFY_USAGE = `Usage:
  luthen verify <file.age> [share.txt ...]

Checks shares (and, once enough are given, that they unlock the file). Writes nothing.
With no share files, asks for one share.
`;

function progressLine(p: Progress): string {
  if (p.groups.length === 1 && p.groupThreshold === 1) {
    const g = p.groups[0]!;
    return `${g.have} of ${g.threshold} needed`;
  }
  const done = p.groups.filter((g) => g.have >= g.threshold).length;
  const parts = p.groups.map((g) => `group ${g.index + 1}: ${g.have}/${g.threshold}${g.have >= g.threshold ? " ✓" : ""}`);
  return `${parts.join("  ")}  — groups ${done} of ${p.groupThreshold}`;
}

function rejectStdinPaths(paths: string[]): void {
  if (paths.includes("-")) {
    throw new UsageError("stdin is reserved for typing shares; pass the .age file and share files as paths");
  }
}

function parse(argv: string[], withOutput: boolean): { output?: string; positionals: string[] } {
  try {
    const r = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: { output: { type: "string", short: "o" } },
    });
    if (!withOutput && r.values.output !== undefined) throw new Error("verify takes no -o option");
    return { output: r.values.output, positionals: r.positionals };
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
}

async function loadShareFiles(paths: string[]): Promise<string[]> {
  const mnemonics: string[] = [];
  for (const path of paths) {
    const text = new TextDecoder().decode(await readInput(path));
    try {
      mnemonics.push(normalizeShareInput(text));
    } catch (e) {
      throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return mnemonics;
}

/**
 * Prompt for shares until `done` says stop. Bad or duplicate shares print their error and are
 * asked for again. End of input before `done` throws NOT_ENOUGH_SHARES.
 */
async function collect(
  mnemonics: string[],
  done: (p: Progress | undefined) => boolean,
  showProgress: boolean,
): Promise<Progress | undefined> {
  let current = mnemonics.length ? progress(mnemonics) : undefined;
  if (showProgress && current && !done(current)) process.stderr.write(`${progressLine(current)}\n`);
  while (!done(current)) {
    const line = await prompt("Share (words or numbers), then Enter: ");
    if (line === null) {
      throw new LuthenError(
        "NOT_ENOUGH_SHARES",
        current ? `Not enough shares: ${progressLine(current)}` : "Not enough shares: none were provided",
      );
    }
    if (line.trim() === "") continue;
    try {
      const mnemonic = normalizeShareInput(line);
      current = progress([...mnemonics, mnemonic]);
      mnemonics.push(mnemonic);
    } catch (e) {
      if (!(e instanceof LuthenError)) throw e;
      process.stderr.write(`error: ${e.message}\n`);
      continue;
    }
    if (showProgress) process.stderr.write(`${progressLine(current)}\n`);
  }
  return current;
}

export async function openCommand(argv: string[]): Promise<number> {
  const { output, positionals } = parse(argv, true);
  if (positionals.length < 1) throw new UsageError("open needs the encrypted file (.age)");
  const [ageFile, ...shareFiles] = positionals as [string, ...string[]];
  rejectStdinPaths(positionals);
  let outPath = output;
  if (outPath === undefined && !process.stdin.isTTY) {
    throw new UsageError("no output chosen: pass -o <path> (or -o - for stdout) when stdin is not a terminal");
  }
  if (outPath !== undefined && outPath !== "-" && pathExists(outPath)) {
    throw new Error(`${outPath} already exists; refusing to overwrite it`);
  }

  const ciphertext = await readInput(ageFile);
  const mnemonics = await loadShareFiles(shareFiles);
  await collect(mnemonics, (p) => p?.complete === true, true);

  if (outPath === undefined) {
    const answer = (await prompt("Write plaintext to (path, or - for stdout): "))?.trim();
    if (!answer) throw new Error("no output path given");
    outPath = answer;
    if (outPath !== "-" && pathExists(outPath)) throw new Error(`${outPath} already exists; refusing to overwrite it`);
  }

  const plaintext = await open(ciphertext, mnemonics);
  try {
    if (outPath === "-") {
      // Zeroing right after relies on Bun copying the buffer into the pipe synchronously (verified with a 20 MB slow-pipe test).
      process.stdout.write(plaintext);
    } else {
      try {
        await writeExclusive(outPath, plaintext);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`${outPath} already exists; refusing to overwrite it`);
        }
        let cleanup = "";
        try {
          unlinkSync(outPath);
        } catch {
          cleanup = `; could not remove the partial file ${outPath}`;
        }
        throw new Error(`writing ${outPath} failed: ${e instanceof Error ? e.message : String(e)}${cleanup || `; the partial file was removed`}`);
      }
      process.stderr.write(`Wrote ${outPath}\n`);
    }
  } finally {
    plaintext.fill(0);
  }
  return 0;
}

export async function verifyCommand(argv: string[]): Promise<number> {
  const { positionals } = parse(argv, false);
  if (positionals.length < 1) throw new UsageError("verify needs the encrypted file (.age)");
  const [ageFile, ...shareFiles] = positionals as [string, ...string[]];
  rejectStdinPaths(positionals);

  const ciphertext = await readInput(ageFile);
  const mnemonics = await loadShareFiles(shareFiles);
  // Prompt for one share only when none were given as files.
  await collect(mnemonics, () => mnemonics.length > 0, false);

  const result = await verify(ciphertext, mnemonics);
  const n = mnemonics.length;
  console.log(`${n} share${n === 1 ? "" : "s"} valid · set ${result.identifier} · ${progressLine(result)}`);
  if (result.complete) console.log(`unlocks ${basename(ageFile)}`);
  return 0;
}
