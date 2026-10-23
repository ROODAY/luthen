// Entry for the luthen.mjs release asset (Node 22+ or Bun); the binaries use main.ts.
import { main } from "./run";
import { runtimeWarning } from "./runtime";

const drain = (s: NodeJS.WriteStream) => new Promise<void>((ok) => s.write("", () => ok()));

// A reader that closes early (`| head`) is not an error; open handles EPIPE in its write callback, but Node also emits it.
for (const s of [process.stdout, process.stderr]) {
  s.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EPIPE") throw e;
  });
}

const warning = runtimeWarning(process.versions);
if (warning) process.stderr.write(`${warning}\n`);
// Exit only once stdout and stderr are flushed: Node may still be writing to a pipe.
void main(process.argv.slice(2)).then(async (code) => {
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
  process.exit(code);
});
