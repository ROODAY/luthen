import { expect, test } from "bun:test";
import { bundleFiles, checkLabels, defaultLabels, summarizeScheme } from "../../src/core/bundle";
import { flat, type Scheme } from "../../src/core/scheme";
import { seal } from "../../src/core/vault";

const grouped: Scheme = {
  groupThreshold: 2,
  groups: [
    { threshold: 1, count: 1 },
    { threshold: 3, count: 5 },
  ],
};

test("summarizeScheme", () => {
  expect(summarizeScheme(flat(3, 5), 3)).toBe("any 3 of 5 shares");
  expect(summarizeScheme(grouped)).toBe("2 of 2 groups; group 1 needs 1 of 1, group 2 needs 3 of 5");
});

test("defaultLabels", () => {
  expect(defaultLabels(flat(2, 3), true)).toEqual(["share-1", "share-2", "share-3"]);
  const g: Scheme = {
    groupThreshold: 2,
    groups: [
      { threshold: 1, count: 1 },
      { threshold: 2, count: 2 },
    ],
  };
  expect(defaultLabels(g, false)).toEqual(["group-1-share-1", "group-2-share-1", "group-2-share-2"]);
});

test("checkLabels", () => {
  expect(checkLabels(["a", "b"], 3)).toContain("needs exactly 3 names, got 2");
  expect(checkLabels(["a", "a"], 2)).toContain("unique");
  expect(checkLabels(["a", "../b"], 2)).toContain("letters");
  expect(checkLabels(["a", "b"], 2)).toBeUndefined();
});

test("bundleFiles", async () => {
  const sealed = await seal(new TextEncoder().encode("hi"), flat(2, 3), { scryptWorkFactor: 10 });
  const labels = ["a", "b", "c"];
  const files = bundleFiles({
    sealed,
    labels,
    name: "doc.txt",
    schemeSummary: "any 2 of 3 shares",
    created: new Date("2026-01-01T00:00:00Z"),
    version: "0.0.0",
  });
  expect(Object.keys(files)).toEqual(labels);
  for (const label of labels) {
    const f = files[label]!;
    expect(Object.keys(f).sort()).toEqual(["RECOVERY.md", "doc.txt.age", "share.txt", "slip39-wordlist.txt"]);
    expect(f["doc.txt.age"]).toEqual(sealed.ciphertext);
    expect(f["share.txt"]).toContain(`Label:    ${label}`);
    expect(f["RECOVERY.md"]).toContain("any 2 of 3 shares");
  }
});
