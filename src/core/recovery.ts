import { WORDLIST } from "./slip39/wordlist";

export interface RecoveryInfo {
  fileName: string;
  schemeSummary: string;
  identifier: number;
  version: string;
}

export function renderWordlist(): string {
  return WORDLIST.join("\n") + "\n";
}

export function renderRecovery(info: RecoveryInfo): string {
  const f = info.fileName;
  return `# Recovering ${f}

This folder holds \`${f}\`, an encrypted file, and the instructions to recover it. The file can only be opened by combining enough SLIP-39 shares (word lists) to rebuild its passphrase. It was created with Luthen ${info.version}.

**Warning:** recover only on an offline machine, or one you would trust with your own passwords. Anyone who sees the shares you type, or the decrypted result, learns the secret.

## Which shares are needed

${info.schemeSummary}

Set ID: ${info.identifier}. Only shares showing this same Set ID work together.

## Recovery with Luthen

\`\`\`
luthen open ${f} share.txt share.txt share.txt -o <output>
\`\`\`

Pass the \`share.txt\` file from each holder (rename or place them in separate paths), as many as the scheme above requires.

## Recovery without Luthen

1. Install the SLIP-39 tool: \`pip install shamir-mnemonic[cli]\`, then run \`shamir recover\`. Enter the words of each share. Press Enter at the passphrase prompt (the passphrase is empty). It prints the secret as hex.
2. Decrypt with age: \`age -d -o <output> ${f}\`. When asked for the passphrase, paste the hex **exactly as printed**. If you derived the secret another way, use lowercase hex.
3. If you only have word numbers, convert them to words with \`slip39-wordlist.txt\` (index 0 = first line).

## Specifications

To recover from first principles:

- SLIP-39: https://github.com/satoshilabs/slips/blob/master/slip-0039.md
- age v1: https://age-encryption.org/v1

Luthen format v1: SLIP-39 (extendable, empty passphrase) splits a 256-bit secret S; the file is age v1 scrypt-passphrase encrypted with passphrase = lowercase hex(S).
`;
}
