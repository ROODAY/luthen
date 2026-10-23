import { unzipSync, zipSync, type Zippable } from "fflate";

/** Stored (uncompressed) zip with every entry stamped `mtime`, so the same input gives identical bytes. */
export function zipFiles(files: Record<string, Uint8Array | string>, mtime: Date): Uint8Array {
  const enc = new TextEncoder();
  const entries: Zippable = {};
  for (const [path, data] of Object.entries(files)) {
    entries[path] = [typeof data === "string" ? enc.encode(data) : data, { level: 0, mtime }];
  }
  return zipSync(entries);
}

export function unzipFiles(bytes: Uint8Array): { path: string; bytes: Uint8Array }[] {
  return Object.entries(unzipSync(bytes))
    .filter(([path]) => !path.endsWith("/"))
    .map(([path, b]) => ({ path, bytes: b }));
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
