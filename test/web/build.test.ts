import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildWeb } from "../../scripts/build-web";

const html = await buildWeb();
const sha = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
const body = (open: string, close: string) => {
  const m = html.match(new RegExp(`${open}([\\s\\S]*?)</${close}>`));
  if (!m) throw new Error(`no ${open}`);
  return m[1]!;
};

test("CSP forbids network access", () => {
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("connect-src 'none'");
});

test("CSP hashes match the inline script and style", () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]!;
  expect(csp).toContain(`script-src ${sha(body('<script type="module">', "script"))}`);
  expect(csp).toContain(`style-src ${sha(body("<style>", "style"))}`);
});

test("page references no external resources", () => {
  const shell = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, "");
  expect(shell).not.toContain("<link");
  expect(shell).not.toMatch(/\ssrc=/);
  for (const [, href] of shell.matchAll(/href="([^"]*)"/g))
    expect(href).toMatch(/^(#|https:\/\/github\.com\/ROODAY\/luthen|https:\/\/rooday\.com\/luthen)/);
});

test("page embeds Luthen's license and every bundled notice", () => {
  for (const s of ["fflate", "age-encryption", "PolyForm Noncommercial", "Required Notice"]) expect(html).toContain(s);
});

test("build is deterministic", async () => {
  expect(await buildWeb()).toBe(html);
});
