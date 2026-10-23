import { WORDLIST } from "./slip39/wordlist";
import { outputName } from "./inputs";

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
luthen open ${f} -s alice/share.txt -s bob/share.txt … -o ${outputName(f)}
\`\`\`

Each holder's file is called \`share.txt\`, so keep them in separate folders. Pass as many share.txt files as you have, each with -s; you'll be prompted for any missing ones.

## Recovery with the Luthen website

Open https://rooday.com/luthen in a browser. For the safest option, download \`luthen.html\` from https://github.com/ROODAY/luthen/releases and open it on an offline machine; it works without a network connection. Choose Open, then drop in this folder's files (or its zip) and enough other holders' folders, zips, or share.txt files. You can also type a share's words.

## Recovery without Luthen

1. Install the SLIP-39 tool (tested with shamir-mnemonic 0.3.0):
   \`pipx install 'shamir-mnemonic[cli]'\`
   If you don't have pipx, use a virtual environment instead:
   \`python3 -m venv luthen-recovery && luthen-recovery/bin/pip install 'shamir-mnemonic[cli]'\`
   and then run \`luthen-recovery/bin/shamir\` wherever these steps say \`shamir\`.
2. Run \`shamir recover\` and enter the words of each share. Enter words in their numbered order: the words in share.txt are numbered in columns, top to bottom (read down the first column, then the next). Alternatively, use the numbers block and convert each number to a word with \`slip39-wordlist.txt\` (number 0 = first line). The SLIP-39 passphrase is empty, which is the default, so just enter the shares. It prints the secret as hex.
3. Install age if you don't have it: https://github.com/FiloSottile/age (packages for most OSes).
4. Decrypt with age: \`age -d -o ${outputName(f)} ${f}\`. This writes the decrypted file to \`${outputName(f)}\`; put a different name after \`-o\` if you want. When asked for the passphrase, paste the hex secret from step 2 **exactly as printed**. If you derived the secret another way, use lowercase hex.

## Specifications

To recover from first principles:

- SLIP-39: https://github.com/satoshilabs/slips/blob/master/slip-0039.md
- age v1: https://age-encryption.org/v1

Luthen format v1: SLIP-39 (extendable, empty passphrase) splits a 256-bit secret S; the file is age v1 scrypt-passphrase encrypted with passphrase = lowercase hex(S).
`;
}
