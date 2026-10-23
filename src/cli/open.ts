import { parseArgs } from "node:util";
import { basename } from "node:path";
import { LuthenError } from "../core/errors";
import { normalizeShareInput } from "../core/sharefile";
import { open, progress, progressLine, verify, type Progress } from "../core/vault";
import { unlinkSync } from "node:fs";
import { pathExists, prompt, readInput, writeExclusive } from "./io";
import { UsageError } from "./seal";

export const OPEN_USAGE = `Usage:
  luthen open <file.age> [-s share.txt ...] [-o <path>|-]

Pass each share.txt with -s/--share (repeatable). Any other shares are asked for at the prompt: type
one share per line (words or numbers).
-o - writes the plaintext to stdout; -o <path> refuses to overwrite an existing file.
Without -o, asks for an output path (needs a terminal).
`;

export const VERIFY_USAGE = `Usage:
  luthen verify <file.age> [-s share.txt ...]

Checks shares (and, once enough are given, that they unlock the file). Writes nothing.
Pass each share.txt with -s/--share (repeatable). With no share files, asks for one share.
`;

function rejectStdinPaths(paths: string[]): void {
  if (paths.includes("-")) {
    throw new UsageError("stdin is reserved for typing shares; pass the .age file and share files as paths");
  }
}

function parse(argv: string[], cmd: "open" | "verify"): { ageFile: string; shareFiles: string[]; output?: string } {
  let r;
  try {
    r = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: { output: { type: "string", short: "o" }, share: { type: "string", short: "s", multiple: true } },
    });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  if (cmd === "verify" && r.values.output !== undefined) throw new UsageError("verify takes no -o option");
  if (r.positionals.length < 1) throw new UsageError(`${cmd} needs the encrypted file (.age)`);
  if (r.positionals.length > 1) {
    throw new UsageError(`${cmd} takes one encrypted file; pass share files with -s/--share (got ${r.positionals.slice(1).join(", ")})`);
  }
  const ageFile = r.positionals[0]!;
  const shareFiles = r.values.share ?? [];
  rejectStdinPaths([ageFile, ...shareFiles]);
  return { ageFile, shareFiles, output: r.values.output };
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
  const { ageFile, shareFiles, output } = parse(argv, "open");
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
      // The callback fires once the stream is done with the buffer, so zeroing in `finally` is safe on Node and Bun.
      await new Promise<void>((ok, fail) => process.stdout.write(plaintext, (e) => (e ? fail(e) : ok())));
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
  const { ageFile, shareFiles } = parse(argv, "verify");

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
