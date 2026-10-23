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
  // An empty data: favicon stops the browser requesting /favicon.ico; it is the only <link allowed.
  const favicon = '<link rel="icon" href="data:,">';
  expect(html.split(favicon)).toHaveLength(2);
  const shell = html
    .replace(favicon, "")
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
