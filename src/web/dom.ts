// Small DOM helpers shared by the Seal, Verify and Open panels.
import { LuthenError } from "../core/errors";

/** Creates an element with attributes and children. Never pass `style` or `on…` attributes (the CSP blocks them). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** Saves `bytes` as `fileName` through a temporary blob URL, revoked once the download has started. */
export function download(bytes: Uint8Array | string, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readFile(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

/** Above this size the browser may be slow or crash; the CLI copes better. */
export const LARGE_FILE = 500 * 1024 * 1024;
const RELEASES = "https://github.com/ROODAY/luthen/releases";

/** The large-file note, hidden until shown; `doing` is the panel's verb ("sealing", "opening"). */
export function largeFileNote(doing: string): HTMLParagraphElement {
  const p = el(
    "p",
    { class: "warn", role: "note" },
    `This file is larger than 500 MB. Your browser may be slow or crash while ${doing} it; the `,
    el("a", { href: RELEASES }, "Luthen command-line tool"),
    " handles large files better.",
  );
  p.hidden = true;
  return p;
}

/** A file to read, named by its path inside any chosen or dropped folder (`alice/share.txt`). */
export interface Picked {
  name: string;
  read: () => Promise<Uint8Array>;
}

// Folder pickers fill in `webkitRelativePath`; plain picks and drops leave it empty.
const picked = (f: File): Picked => ({ name: f.webkitRelativePath || f.name, read: () => readFile(f) });

/** Files from a file input. */
export function pickedFiles(files: FileList | null): Picked[] {
  return [...(files ?? [])].map(picked);
}

/**
 * Files from a drop, reading dropped folders recursively. Must be called inside the drop handler:
 * the browser empties `items` once it returns. Falls back to the flat file list where entries are unsupported.
 */
export async function droppedFiles(dt: DataTransfer): Promise<Picked[]> {
  const items = [...(dt.items ?? [])].filter((i) => i.kind === "file");
  if (!items.length || typeof items[0]!.webkitGetAsEntry !== "function") return pickedFiles(dt.files);
  const roots = items.map((i) => i.webkitGetAsEntry() ?? i.getAsFile());
  const out: Picked[] = [];
  for (const root of roots) {
    if (root instanceof File) out.push(picked(root));
    else if (root) await walk(root, "", out);
  }
  return out;
}

async function walk(entry: FileSystemEntry, prefix: string, out: Picked[]): Promise<void> {
  const name = prefix + entry.name;
  if (isFileEntry(entry)) {
    out.push({ name, read: () => new Promise<File>((ok, fail) => entry.file(ok, fail)).then(readFile) });
    return;
  }
  if (!isDirectoryEntry(entry)) return;
  let children: FileSystemEntry[];
  try {
    children = await readAll(entry.createReader());
  } catch (e) {
    out.push({ name, read: () => Promise.reject(e) });
    return;
  }
  for (const child of children) await walk(child, `${name}/`, out);
}

/** `readEntries` returns at most ~100 entries per call; keep calling until it returns none. */
async function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

const isFileEntry = (e: FileSystemEntry): e is FileSystemFileEntry => e.isFile;
const isDirectoryEntry = (e: FileSystemEntry): e is FileSystemDirectoryEntry => e.isDirectory;

/** Core errors carry user-facing messages; anything else is a bug and says so. */
export function errorText(e: unknown): string {
  if (e instanceof LuthenError) return e.message;
  return `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * Yields long enough for the browser to paint, so a "Working…" message shows before CPU-bound work
 * starts. The timer fallback resolves even where animation frames are paused (background tabs).
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100);
  });
}
