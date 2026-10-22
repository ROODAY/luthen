import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

/** Print `question` to stderr and read one line from stdin (works when piped). */
export async function prompt(question: string): Promise<string> {
  process.stderr.write(question);
  const rl = createInterface({ input: process.stdin, terminal: false });
  try {
    return await new Promise<string>((resolve) => {
      rl.once("line", (line) => resolve(line));
      rl.once("close", () => resolve(""));
    });
  } finally {
    rl.close();
  }
}

/** Read a file, or all of stdin when `pathOrDash` is "-". */
export async function readInput(pathOrDash: string): Promise<Uint8Array> {
  if (pathOrDash === "-") {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
    return new Uint8Array(Buffer.concat(chunks));
  }
  return new Uint8Array(readFileSync(pathOrDash));
}

/** Write a new file; fails if it already exists. */
export async function writeExclusive(path: string, data: Uint8Array | string): Promise<void> {
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Flush a directory entry to disk. Not supported everywhere (e.g. Windows), so failures are ignored. */
function fsyncDir(path: string): void {
  try {
    const fd = openSync(path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // directory fsync is unsupported on some platforms
  }
}

export function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write `files` (subdirectory -> file name -> contents) under `outDir`. Refuses if `outDir` exists.
 * Everything is staged in a sibling `.partial-<hex>` directory and renamed into place at the end.
 */
export async function writeBundleDir(
  outDir: string,
  files: Record<string, Record<string, Uint8Array | string>>,
): Promise<void> {
  if (pathExists(outDir)) throw new Error(`${outDir} already exists`);
  const staging = `${outDir}.partial-${randomBytes(6).toString("hex")}`;
  try {
    if (!pathExists(dirname(staging))) mkdirSync(dirname(staging), { recursive: true });
    mkdirSync(staging);
    for (const [sub, entries] of Object.entries(files)) {
      mkdirSync(join(staging, sub));
      for (const [name, data] of Object.entries(entries)) {
        await writeExclusive(join(staging, sub, name), data);
      }
    }
    for (const sub of Object.keys(files)) fsyncDir(join(staging, sub));
    fsyncDir(staging);
    renameSync(staging, outDir);
    fsyncDir(dirname(outDir));
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

/** Overwrite a file with random bytes, flush it to disk, then delete it. */
export async function shred(path: string): Promise<void> {
  const st = lstatSync(path);
  if (!st.isFile()) throw new Error(`${path} is not a regular file (symlink, device or pipe); refusing to shred it`);
  const size = st.size;
  const fd = openSync(path, "r+");
  try {
    const chunk = 1 << 20;
    for (let off = 0; off < size; off += chunk) {
      const len = Math.min(chunk, size - off);
      writeSync(fd, randomBytes(len), 0, len, off);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  unlinkSync(path);
}
