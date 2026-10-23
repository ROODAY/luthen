// View-building helpers for the Seal panel: form controls, inline messages and the post-seal download list.
import type { BundleFiles } from "../core/bundle";
import type { Sealed } from "../core/vault";
import { zipFiles } from "../core/zip";
import { download, el } from "./dom";

export function numberInput(value: number, label: string): HTMLInputElement {
  const attrs = { type: "number", min: "1", max: "16", step: "1", inputmode: "numeric", "aria-label": label };
  return el("input", { ...attrs, value: String(value) });
}

export function field(label: string, input: HTMLElement): HTMLLabelElement {
  return el("label", { class: "field" }, el("span", {}, label), input);
}

/** An inline message line, hidden until `say` gives it text. */
export function message(cls = "msg"): HTMLParagraphElement {
  const p = el("p", { class: cls, "aria-live": "polite" });
  p.hidden = true;
  return p;
}

export function say(p: HTMLElement, text: string | undefined): void {
  p.textContent = text ?? "";
  p.hidden = !text;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface SealResult {
  sealed: Sealed;
  files: BundleFiles;
  labels: string[];
  name: string;
  summary: string;
  created: Date;
}

/** One download button per holder (`<label>.zip`) plus "Download all" (`luthen-<name>.zip`, `<label>/<file>`). Zips are built on click. */
export function resultsView({ sealed, files, labels, name, summary, created }: SealResult): Node[] {
  const holders = labels.map((label, i) => {
    const btn = el("button", { type: "button" }, `Download ${label}.zip`);
    btn.addEventListener("click", () => download(zipFiles(files[label]!, created), `${label}.zip`));
    return el(
      "li",
      {},
      el("div", {}, el("strong", {}, label), el("span", { class: "hint" }, sealed.shares[i]!.position)),
      btn,
    );
  });
  const all = el("button", { type: "button", class: "primary" }, "Download all");
  all.addEventListener("click", () => {
    const entries: Record<string, Uint8Array | string> = {};
    for (const [label, contents] of Object.entries(files)) {
      for (const [file, data] of Object.entries(contents)) entries[`${label}/${file}`] = data;
    }
    download(zipFiles(entries, created), `luthen-${name}.zip`);
  });
  return [
    el("h2", {}, `Sealed ${name}.age`),
    el("p", {}, `Set ID: ${sealed.identifier}`, el("br"), `Scheme: ${summary}`),
    el(
      "p",
      { class: "hint" },
      "Give each holder only their own zip. It holds their share, the encrypted file and recovery instructions.",
    ),
    el("ul", { class: "holders" }, ...holders),
    all,
    el("p", { class: "hint" }, `luthen-${name}.zip has one folder per holder.`),
  ];
}
