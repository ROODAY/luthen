import { parseArgs } from "node:util";
import { basename } from "node:path";
import { NAME_RE, bundleFiles, checkLabels, defaultLabels, summarizeScheme } from "../core/bundle";
import { flat, totalShares, validateScheme, type Scheme } from "../core/scheme";
import { seal } from "../core/vault";
import pkg from "../../package.json";
import { pathExists, prompt, readInput, shred, writeBundleDir } from "./io";

/** A bad command line: reported with usage, exit code 2. */
export class UsageError extends Error {}

export const SEAL_USAGE = `Usage:
  luthen seal <file|-> --shares N --threshold M [options]
  luthen seal <file|-> --group-threshold G --group m/n [--group m/n ...] [options]

Options:
  --name <s>        base name of the encrypted file (default: input name, or "vault" for stdin)
  --names a,b,...   one label per share, in order (default: share-1..N, or group-G-share-M)
  --out <dir>       output directory (default: ./luthen-<name>)
  --shred           overwrite and delete the input file after sealing
  --yes             skip the --shred confirmation

Examples:
  luthen seal secrets.txt --shares 5 --threshold 3
  luthen seal wallet.dat --shares 3 --threshold 2 --names alice,bob,carol --out ./wallet-shares
  luthen seal secrets.txt --group-threshold 2 --group 1/1 --group 3/5
  cat key.pem | luthen seal - --name key --shares 3 --threshold 2
`;

function int(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError(`${flag} must be a whole number, got "${value}"`);
  return Number(value);
}

export async function sealCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        shares: { type: "string" },
        threshold: { type: "string" },
        "group-threshold": { type: "string" },
        group: { type: "string", multiple: true },
        name: { type: "string" },
        names: { type: "string" },
        out: { type: "string" },
        shred: { type: "boolean" },
        yes: { type: "boolean" },
      },
    });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new UsageError("seal needs exactly one input: a file path, or - for stdin");
  const input = positionals[0]!;
  const fromStdin = input === "-";
  if (values.shred && fromStdin) throw new UsageError("--shred cannot be used with stdin input");

  const flatMode = values.shares !== undefined || values.threshold !== undefined;
  const groupMode = values["group-threshold"] !== undefined || values.group !== undefined;
  if (flatMode === groupMode) {
    throw new UsageError("choose one scheme: --shares N --threshold M, or --group-threshold G with --group m/n");
  }

  let scheme: Scheme;
  let flatThreshold: number | undefined;
  if (flatMode) {
    if (values.shares === undefined || values.threshold === undefined) {
      throw new UsageError("--shares and --threshold must be given together");
    }
    flatThreshold = int(values.threshold, "--threshold");
    const shares = int(values.shares, "--shares");
    if (flatThreshold > shares) throw new UsageError(`--threshold ${flatThreshold} is more than --shares ${shares}`);
    scheme = flat(flatThreshold, shares);
  } else {
    if (values["group-threshold"] === undefined || !values.group?.length) {
      throw new UsageError("--group-threshold and at least one --group m/n must be given together");
    }
    scheme = {
      groupThreshold: int(values["group-threshold"], "--group-threshold"),
      groups: values.group.map((g) => {
        const m = /^(\d+)\/(\d+)$/.exec(g);
        if (!m) throw new UsageError(`--group must look like m/n (for example 3/5), got "${g}"`);
        return { threshold: Number(m[1]), count: Number(m[2]) };
      }),
    };
  }
  try {
    validateScheme(scheme);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }

  const total = totalShares(scheme);
  let labels: string[];
  if (values.names !== undefined) {
    labels = values.names.split(",");
    const problem = checkLabels(labels, total);
    if (problem) throw new UsageError(`--names ${problem}`);
  } else {
    labels = defaultLabels(scheme, flatMode);
  }

  const name = values.name ?? (fromStdin ? "vault" : basename(input));
  if (!NAME_RE.test(name)) {
    throw new UsageError(
      values.name === undefined
        ? `input file name "${name}" can't be used as a bundle name; pass --name <name>`
        : "--name may only use letters, digits, '.', '_' and '-'",
    );
  }
  const fileName = `${name}.age`;
  const outDir = values.out ?? `./luthen-${name}`;

  // Refuse before touching the input.
  if (pathExists(outDir)) throw new Error(`${outDir} already exists; choose another --out or remove it`);

  const plaintext = await readInput(input);
  const sealed = await seal(plaintext, scheme);

  const schemeSummary = summarizeScheme(scheme, flatThreshold);
  const files = bundleFiles({ sealed, labels, name, schemeSummary, created: new Date(), version: pkg.version });
  await writeBundleDir(outDir, files);

  console.log(`Sealed ${fileName} into ${outDir}`);
  console.log(`Set ID: ${sealed.identifier}`);
  console.log(`Scheme: ${schemeSummary}`);
  console.log("Hand one share folder to each holder.");

  if (values.shred) {
    process.stderr.write(
      "warning: shredding overwrites the file once and then deletes it, but SSDs and flash storage do not\n" +
        "guarantee that old data is erased (wear leveling, snapshots, backups). For real protection, keep\n" +
        "sensitive files on an encrypted volume (for example BitLocker) from the start.\n",
    );
    const confirmed = values.yes === true || (await prompt('Type "shred" to confirm: '))?.trim() === "shred";
    if (!confirmed) {
      process.stderr.write("not shredded.\n");
      console.log(`The input file ${input} was left untouched.`);
      return 0;
    }
    try {
      await shred(input);
    } catch (e) {
      throw new Error(
        `bundles written to ${outDir}, but shredding ${input} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    console.log(`The input file ${input} was shredded.`);
  } else if (!fromStdin) {
    console.log(`The input file ${input} was left untouched.`);
  }
  return 0;
}
