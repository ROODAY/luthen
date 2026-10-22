#!/usr/bin/env bun
import pkg from "../../package.json";
import { OPEN_USAGE, VERIFY_USAGE, openCommand, verifyCommand } from "./open";
import { SEAL_USAGE, UsageError, sealCommand } from "./seal";

const USAGE = `luthen ${pkg.version} - split an encrypted file's key across SLIP-39 shares

Commands:
  seal      encrypt a file and write one folder per share holder
  open      decrypt a file using enough shares
  verify    check shares (and that they unlock the file) without writing anything

Run "luthen <command> --help" for details.

${SEAL_USAGE}
${OPEN_USAGE}
${VERIFY_USAGE}`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "--version") {
    console.log(`luthen ${pkg.version}`);
    return 0;
  }
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") {
    if (cmd === undefined) {
      console.error(USAGE);
      return 2;
    }
    console.log(USAGE);
    return 0;
  }
  try {
    if (cmd === "seal") {
      if (rest.includes("--help") || rest.includes("-h")) {
        console.log(SEAL_USAGE);
        return 0;
      }
      return await sealCommand(rest);
    }
    if (cmd === "open" || cmd === "verify") {
      if (rest.includes("--help") || rest.includes("-h")) {
        console.log(cmd === "open" ? OPEN_USAGE : VERIFY_USAGE);
        return 0;
      }
      return await (cmd === "open" ? openCommand(rest) : verifyCommand(rest));
    }
    throw new UsageError(`unknown command "${cmd}"`);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`error: ${e.message}\n\n${cmd === "seal" ? SEAL_USAGE : cmd === "open" ? OPEN_USAGE : cmd === "verify" ? VERIFY_USAGE : USAGE}`);
      return 2;
    }
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
