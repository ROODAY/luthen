import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildWeb, escapeInlineScript } from "../../scripts/build-web";

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
  // The favicon is inlined as a data: URI, so the page never requests /favicon.ico.
  const favicon = /<link rel="icon" type="image\/png" href="data:image\/png;base64,[A-Za-z0-9+/=]+">/;
  const m = html.match(favicon);
  expect(m).not.toBeNull();
  const bytes = Buffer.from(m![0].match(/base64,([A-Za-z0-9+/=]+)"/)![1]!, "base64");
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const shell = html
    .replace(m![0], "")
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

test("escapeInlineScript neutralises </script and <!--", () => {
  for (const [input, tag] of [["a</script>b", "script"], ["</SCRIPT", "SCRIPT"]] as const) {
    const out = escapeInlineScript(input);
    expect(out.toLowerCase()).not.toContain("</script");
    expect(out).toContain(`<\\/${tag}`);
  }
  expect(escapeInlineScript("<!--")).toBe("<\\!--");
});

test("inline script contains no </script or <!--", () => {
  const js = body('<script type="module">', "script").toLowerCase();
  expect(js).not.toContain("</script");
  expect(js).not.toContain("<!--");
});

test("inline script parses as JavaScript", () => {
  const js = body('<script type="module">', "script");
  expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(js)).not.toThrow();
});
