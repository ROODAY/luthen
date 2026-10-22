# Luthen

Luthen is a command-line tool that encrypts a file with age and splits the encryption key into SLIP-39 mnemonic shares, so that a chosen number of shares is needed to recover the file. It runs entirely offline.

## Install

Download the binary for your platform, plus `SHA256SUMS`, from the [Releases](https://github.com/ROODAY/luthen/releases) page. On Linux and macOS, make it executable with `chmod +x`.

## Verify a release

Check the checksum, then the build provenance attestation:

```
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify luthen-linux-x64 --repo ROODAY/luthen
```

To rebuild it yourself, check out the release tag, install the Bun version in `.bun-version`, and run `bash scripts/build.sh dist`. The resulting `dist/SHA256SUMS` should match the published one.

## Usage

Split a file into 3 shares (one bundle directory each), any 2 of which recover it:

```
luthen seal secrets.txt --shares 3 --threshold 2 --out bundle
```

Recover it (omit share files to be prompted for the words):

```
luthen open bundle/share-1/secrets.txt.age bundle/share-1/share.txt bundle/share-2/share.txt -o secrets.txt
```

Check that shares can decrypt a bundle without writing the plaintext:

```
luthen verify bundle/share-1/secrets.txt.age bundle/share-1/share.txt bundle/share-2/share.txt
```

Recovery never requires Luthen: see `RECOVERY.md` in any bundle.

## Status

Pre-release. The interface and file formats may change without notice.

## Licensing

Luthen is source-available under the PolyForm Noncommercial License 1.0.0. It is not OSI open source. It is free for personal and noncommercial use. Commercial rights are reserved to the owner. See `LICENSE`.

## Contributions

Pull requests are not accepted. Bug reports are welcome.
