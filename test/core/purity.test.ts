import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test("src/core imports no node:, bun, or fs modules", () => {
  const all = files("src/core");
  expect(all.length).toBeGreaterThan(0);
  for (const f of all) expect([f, /from ["'](node:|bun|fs)/.test(readFileSync(f, "utf8"))]).toEqual([f, false]);
});
