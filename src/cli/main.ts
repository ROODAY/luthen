#!/usr/bin/env bun
import pkg from "../../package.json";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(`luthen ${pkg.version}`);
}
