// Writes THIRD_PARTY_NOTICES.txt for release binaries: third_party/NOTICE plus the license
// of every package bundled into the binary (runtime dependencies, followed transitively).
// Usage: bun scripts/gen-notices.ts <out-file>
import { writeFileSync } from "node:fs";
import { renderNotices } from "./notices";

const out = process.argv[2];
if (!out) throw new Error("usage: bun scripts/gen-notices.ts <out-file>");

writeFileSync(
  out,
  renderNotices({
    header: [
      "Luthen release binaries bundle the third-party material below.",
      "Luthen's own code is licensed under LICENSE (PolyForm Noncommercial 1.0.0).",
    ].join("\n"),
    includeLicense: false,
  }),
);
