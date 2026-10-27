<p align="center">
  <img src="assets/logo.png" alt="Luthen logo" width="128">
</p>

# Luthen

Luthen is a command-line tool that encrypts a file with age and splits the encryption key into SLIP-39 mnemonic shares, so that a chosen number of shares is needed to recover the file. It runs entirely offline. A [web app](#web-app) does the same in the browser; its `seal` zips have the same contents as the CLI's `seal` folders.

## Install

Download the binary for your platform, plus `SHA256SUMS`, from the [Releases](https://github.com/ROODAY/luthen/releases) page. On Linux and macOS, make it executable with `chmod +x`.

### Run from source

Install the Bun version in `.bun-version`, then:

```
bun install
bun src/cli/main.ts --help
```

### Run with Node or Bun

If you already have Node 22 or newer, or Bun, download `luthen.mjs` (about 150 KB instead of the ~100 MB binaries, which embed a JavaScript runtime) plus `SHA256SUMS` from [Releases](https://github.com/ROODAY/luthen/releases), verify it like a binary (`gh attestation verify luthen.mjs --repo ROODAY/luthen`), and run:

```
node luthen.mjs --help
bun luthen.mjs --help
```

## Verify a release

Check the checksum, then the build provenance attestation:

```
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify luthen-linux-x64 --repo ROODAY/luthen
```

`luthen.mjs` and `luthen.html` (the [web app](#web-app)) are listed in `SHA256SUMS` and attested too.

On macOS, check the checksum with `shasum -a 256 -c SHA256SUMS --ignore-missing`. On Windows (PowerShell), run `Get-FileHash <file> -Algorithm SHA256` and compare the hash with the matching line in `SHA256SUMS`.

To rebuild it yourself, check out the release tag, install the Bun version in `.bun-version`, and run `bash scripts/build.sh dist`. The resulting `dist/SHA256SUMS` should match the published one.

## Web app

https://rooday.com/luthen does the same as the CLI in your browser, with everything computed locally. For offline use, download `luthen.html` from [Releases](https://github.com/ROODAY/luthen/releases) and open it. Its `seal` zips have the same contents as the CLI's bundle folders.

Verify the downloaded file like a binary:

```
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify luthen.html --repo ROODAY/luthen
```

To check the hosted page, compare the output of this with the `luthen.html` line in `SHA256SUMS`:

```
curl -s https://rooday.com/luthen/ | sha256sum
```

Develop with `bun run dev:web`; build `luthen.html` with `bun run build:web`.

## Usage

Split a file into 3 shares (one bundle directory each), any 2 of which recover it:

```
luthen seal secrets.txt --shares 3 --threshold 2 --out bundle
```

Recover it (omit share files to be prompted for the words):

```
luthen open bundle/share-1/secrets.txt.age -s bundle/share-1/share.txt -s bundle/share-2/share.txt -o secrets.txt
```

Check that shares can decrypt a bundle without writing the plaintext:

```
luthen verify bundle/share-1/secrets.txt.age -s bundle/share-1/share.txt -s bundle/share-2/share.txt
```

Recovery never requires Luthen: see `RECOVERY.md` in any bundle.

## Security notes

- Files Luthen writes (bundle files and `open` output) are created readable only by you (mode 0600, directories 0700). This has no effect on Windows.
- Memory hygiene is best effort. JavaScript cannot guarantee that secrets are wiped from memory: the age passphrase is an immutable string that stays until garbage collected, and the runtime may keep copies. Byte buffers holding the secret and the plaintext are zeroed where practical.
- The web app's page CSP forbids all network requests. Browser memory hygiene is best effort. Browser extensions can read page contents, so use a clean profile or open the downloaded `luthen.html` offline.

## Status

Pre-release. The interface and file formats may change without notice.

## Licensing

Luthen is source-available under the PolyForm Noncommercial License 1.0.0. It is not OSI open source. It is free for personal and noncommercial use. Commercial rights are reserved to the owner. See `LICENSE`. Release binaries also bundle third-party code under its own licenses (MIT, BSD-3-Clause); see `THIRD_PARTY_NOTICES.txt` attached to each release.

## Contributions

Pull requests are not accepted. Bug reports are welcome.
