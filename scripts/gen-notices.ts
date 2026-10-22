// Writes THIRD_PARTY_NOTICES.txt for release binaries: third_party/NOTICE plus the license
// of every package bundled into the binary (runtime dependencies, followed transitively).
// Usage: bun scripts/gen-notices.ts <out-file>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: bun scripts/gen-notices.ts <out-file>");

const root = join(import.meta.dir, "..");
const pkg = (name: string) => JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));

const seen = new Set<string>();
const visit = (name: string) => {
  if (seen.has(name)) return;
  seen.add(name);
  for (const dep of Object.keys(pkg(name).dependencies ?? {})) visit(dep);
};
for (const dep of Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies)) visit(dep);

const sections = [...seen].sort().map((name) => {
  const dir = join(root, "node_modules", name);
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  if (!file) throw new Error(`no license file in ${name}`);
  const { version, license } = pkg(name);
  return `${name} ${version} (${license})\n${"-".repeat(40)}\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`;
});

writeFileSync(
  out,
  [
    "Luthen release binaries bundle the third-party material below.",
    "Luthen's own code is licensed under LICENSE (PolyForm Noncommercial 1.0.0).",
    "",
    readFileSync(join(root, "third_party", "NOTICE"), "utf8").trim(),
    "",
    "Bundled npm packages",
    "====================",
    "",
    sections.join("\n"),
  ].join("\n"),
);
