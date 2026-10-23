#!/usr/bin/env bun
// Entry for the compiled binaries and `bun src/cli/main.ts`; luthen.mjs uses script.ts.
import { main } from "./run";

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
