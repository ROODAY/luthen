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
