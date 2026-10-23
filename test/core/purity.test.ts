import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

for (const dir of ["src/core", "src/web"]) {
  test(`${dir} imports no node:, bun, or fs modules`, () => {
    const all = files(dir);
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) expect([f, /from ["'](node:|bun|fs)/.test(readFileSync(f, "utf8"))]).toEqual([f, false]);
  });
}
