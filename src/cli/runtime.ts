/** The warning `luthen.mjs` prints on Node older than the oldest tested line; undefined under Bun, which reports a Node version too. */
export function runtimeWarning(versions: { node?: string; bun?: string }): string | undefined {
  if (versions.bun || !versions.node) return undefined;
  if (Number.parseInt(versions.node, 10) >= 22) return undefined;
  return `luthen.mjs is tested on Node 22 and newer; you're on v${versions.node}`;
}
