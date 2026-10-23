import { expect, test } from "bun:test";
import { runtimeWarning } from "../../src/cli/runtime";

test("runtimeWarning warns on Node older than 22", () => {
  expect(runtimeWarning({ node: "20.19.0" })).toBe("luthen.mjs is tested on Node 22 and newer; you're on v20.19.0");
});

test("runtimeWarning is silent on Node 22+, under Bun, and when the version is unknown", () => {
  for (const v of [{ node: "22.0.0" }, { node: "24.22.1" }, { node: "18.0.0", bun: "1.4.4" }, {}]) expect(runtimeWarning(v)).toBeUndefined();
});
