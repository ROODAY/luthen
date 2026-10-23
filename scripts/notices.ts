// Renders third-party notices: a header, optionally Luthen's own LICENSE, third_party/NOTICE, then the
// license of every runtime dependency (followed transitively). Feeds both the release
// THIRD_PARTY_NOTICES.txt (scripts/gen-notices.ts) and the web page (scripts/build-web.ts).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = (name: string) => JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));

export function renderNotices(opts: { header: string; includeLicense: boolean }): string {
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of Object.keys(pkg(name).dependencies ?? {})) visit(dep);
  };
  for (const dep of Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies)) visit(dep);

  const sections = [...seen].sort().map((name) => {
    const dir = join(root, "node_modules", name);
    const file = readdirSync(dir).sort().find((f) => /^(licen[cs]e|copying)/i.test(f));
    if (!file) throw new Error(`no license file in ${name}`);
    const { version, license } = pkg(name);
    return `${name} ${version} (${license})\n${"-".repeat(40)}\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`;
  });

  return [
    opts.header,
    ...(opts.includeLicense
      ? ["", "Luthen", "======", "", readFileSync(join(root, "LICENSE"), "utf8").trim(), ""]
      : [""]),
    readFileSync(join(root, "third_party", "NOTICE"), "utf8").trim(),
    "",
    "Bundled npm packages",
    "====================",
    "",
    sections.join("\n"),
  ].join("\n");
}
