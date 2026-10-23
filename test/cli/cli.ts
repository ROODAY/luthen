import { resolve } from "node:path";

/** The command under test: `LUTHEN_CLI` (whitespace-split, e.g. "node /abs/dist/luthen.mjs") or the source entry under Bun. */
export const CLI: string[] = process.env.LUTHEN_CLI?.trim().split(/\s+/) ?? ["bun", resolve(import.meta.dir, "../../src/cli/main.ts")];
