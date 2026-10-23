// Builds the single-file web app: bundles src/web/main.ts, inlines it and style.css into index.html,
// embeds the license notices, and pins both inline blocks with a hash-based CSP.
// Usage: bun scripts/build-web.ts <out-file>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderNotices } from "./notices";

const web = join(import.meta.dir, "..", "src", "web");

const LINK = '<link rel="stylesheet" href="./style.css">';
const SCRIPT = '<script type="module" src="./main.ts"></script>';
const MARKER = "<!-- LICENSES -->";
const CHARSET = '<meta charset="utf-8">';

const sha256 = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Replaces the single occurrence of `marker`; a function replacement keeps `$` in bundled code literal.
function replaceOnce(html: string, marker: string, replacement: string): string {
  const at = html.indexOf(marker);
  if (at < 0 || html.indexOf(marker, at + 1) >= 0) throw new Error(`index.html must contain exactly one ${marker}`);
  return html.replace(marker, () => replacement);
}

export async function buildWeb(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(web, "main.ts")],
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "web bundle failed");
  if (result.outputs.length !== 1) throw new Error(`expected one bundle output, got ${result.outputs.length}`);
  const script = (await result.outputs[0]!.text()).replace(/<\/script/gi, "<\/script");
  const style = readFileSync(join(web, "style.css"), "utf8");
  if (/<\/style/i.test(style)) throw new Error("style.css must not contain </style");

  const notices = renderNotices({ header: "This page bundles the third-party material below.", includeLicense: true });
  const csp = [
    "default-src 'none'",
    `script-src ${sha256(script)}`,
    `style-src ${sha256(style)}`,
    "img-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

  let html = readFileSync(join(web, "index.html"), "utf8");
  html = replaceOnce(html, CHARSET, `${CHARSET}\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  html = replaceOnce(html, LINK, `<style>${style}</style>`);
  html = replaceOnce(html, SCRIPT, `<script type="module">${script}</script>`);
  html = replaceOnce(html, MARKER, `<pre>${escapeHtml(notices)}</pre>`);
  return html;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: bun scripts/build-web.ts <out-file>");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await buildWeb());
}
