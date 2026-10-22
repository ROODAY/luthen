#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <outdir>" >&2
  exit 2
fi

outdir="$1"
cd "$(dirname "$0")/.."
rm -rf "$outdir"
mkdir -p "$outdir"

for target in bun-linux-x64 bun-linux-arm64 bun-darwin-x64 bun-darwin-arm64 bun-windows-x64; do
  name="${target#bun-}"
  ext=""
  [ "${name%%-*}" = "windows" ] && ext=".exe"
  bun build src/cli/main.ts --compile --minify --target="$target" --outfile "$outdir/luthen-$name$ext"
done

(cd "$outdir" && LC_ALL=C sha256sum luthen-* | LC_ALL=C sort -k2 > SHA256SUMS)
