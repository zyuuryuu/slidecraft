# Code Signing Policy

This document is SlideCraft's code-signing policy for the
[SignPath Foundation](https://signpath.org/) free code-signing program for open-source software. It
describes how release binaries are built and distributed, and how Windows installers **will be**
Authenticode-signed once the project is approved for the program.

> **Status:** SlideCraft has **applied** to the SignPath Foundation program for a Windows
> Authenticode certificate. Windows installers are **currently unsigned** — that is precisely why we
> are applying. The signing step described below is added to the release workflow **after** approval;
> the private key is issued to and held by SignPath and never by this project.

## Project

- **Product:** SlideCraft — a desktop application (Tauri v2 + React + TypeScript) that turns
  Markdown/YAML into editable PowerPoint (`.pptx`) decks by filling a template's placeholders.
  Installers ship for Windows, macOS, and Linux.
- **Repository (single source of truth):** <https://github.com/zyuuryuu/slidecraft>
- **License:** [Apache-2.0](LICENSE) (OSI-approved).
- **Maintainer:** zyuuryuu — the sole committer, reviewer, and release approver.
- **Free distribution:** all release artifacts are downloadable at no cost from
  [GitHub Releases](https://github.com/zyuuryuu/slidecraft/releases).

## What is (to be) signed

SignPath signing is requested only for the **Windows** installers, which are otherwise flagged by
SmartScreen as coming from an unknown/unverified publisher. Once approved, they are Authenticode-signed
with the **SignPath Foundation** certificate (the verified publisher shown to users is
"SignPath Foundation", per the program's shared-certificate model).

| Platform | Release artifact (v0.2.1) | Signing |
| --- | --- | --- |
| Windows x64 | `SlideCraft_<version>_x64_en-US.msi` | **Authenticode via SignPath** (this policy) |
| Windows x64 | `SlideCraft_<version>_x64-setup.exe` (NSIS) | **Authenticode via SignPath** (this policy) |
| macOS arm64 | `SlideCraft_<version>_aarch64.dmg` (and `SlideCraft_aarch64.app.tar.gz`) | Ad-hoc signed (`codesign -s -`), **not** notarized; distributed via a [Homebrew cask](packaging/homebrew/). Apple Silicon only — no Intel build in recent releases. |
| Linux x64 | `.AppImage` / `.deb` / `.rpm` | Not signed |

Only official release artifacts produced by the CI workflow below are eligible for signing.
Development builds, forks, and locally built binaries are never signed with the project's certificate.
(Exact filenames per release are on the [Releases page](https://github.com/zyuuryuu/slidecraft/releases).)

## Build and signing process

1. **Build.** A maintainer pushes a version tag (`v<x.y.z>`). The public GitHub Actions workflow
   [`.github/workflows/release.yml`](.github/workflows/release.yml) builds the installers for every OS
   on GitHub-hosted runners, from this repository's source only, and attaches them to a **draft**
   GitHub Release. The workflow and its actions (pinned by commit SHA) are public and auditable.
2. **Sign (Windows) — added after SignPath approval.** Once the certificate is provisioned, the
   release workflow submits the built Windows `.msi` and `.exe` to SignPath for Authenticode signing
   (via the `signpath/github-action-submit-signing-request` action), and the signed artifacts replace
   the unsigned ones on the draft release. CI holds only a **SignPath API token** that authorizes a
   signing *request* — never the key. Signing is gated by SignPath's project configuration to builds
   that originate from **this repository's release workflow on a version tag** (`refs/tags/v*`);
   manual `workflow_dispatch` runs are for testing and are **not** submitted for signing.
3. **Review & publish.** The maintainer verifies the draft's installers and then publishes the
   release. Publishing makes the (signed) binaries the official download.

## Private key management

- The Authenticode signing certificate and its **private key are held exclusively by SignPath in an
  HSM**. The key is never exported.
- The private key is **never** present in this repository, in GitHub Actions secrets, or on any
  maintainer machine. CI holds only a SignPath API token that authorizes a signing *request*; it
  cannot extract or use the key outside SignPath's infrastructure.
- Signing requests are authorized by the maintainer through SignPath and are further constrained by
  SignPath's per-project policy (origin repository, workflow, and trigger).
- **Defense in depth against accidental leaks.** No signing key or updater key is committed or handled
  in CI today. To keep it that way, key/secret file patterns are `.gitignore`d and CI runs
  [gitleaks](.github/workflows/security.yml) on every push/PR — a **required** gate that blocks the
  merge if any credential or private key is ever committed. The SignPath API token (added after
  approval) is stored as a GitHub encrypted secret and used only by the tag-triggered release job.

## Authorization and roles

SlideCraft is currently maintained by a single person (zyuuryuu), who is the only party able to commit
code, merge changes, cut releases, and approve signing requests. Should additional maintainers join,
this policy will be updated to name the individuals authorized to approve signing.

## Integrity and provenance of the signed artifacts

- Every artifact is built by the public CI workflow from tagged, public source — the chain
  commit → tag → CI build → release is auditable by anyone, and the signed binary is the exact CI
  output.
- **The app is benign.** SlideCraft is a document-generation tool. It optionally bundles:
  - an **offline AI runtime** — [llamafile](https://github.com/Mozilla-Ocho/llamafile) (Mozilla Ocho / Justine Tunney), an Actually-Portable-Executable that runs a language model locally. Model weights are downloaded from **pinned URLs verified by SHA-256** (see [SECURITY.md](SECURITY.md)). The runtime is **inert until the user explicitly enables offline AI**.
  - an **MCP server + collaboration host** that bind to **loopback only**, gated by a **per-launch bearer token**, so an upstream AI (e.g. Claude) can assist authoring on the user's own machine.
  - Neither component makes outbound network connections unless the user configures an external AI provider; the renderer runs under a strict CSP (`default-src 'self'`). See the [security model](docs/adr/0010-security-model.md) and [security review](docs/adr/0016-security-review-theme4.md). The Windows signing target is the Tauri app installer; the bundled runtime ships inert inside it.

## Distribution

- **GitHub Releases:** <https://github.com/zyuuryuu/slidecraft/releases>
- **macOS (Homebrew tap):** `brew install --cask zyuuryuu/slidecraft/slidecraft`

## Contact

Security or signing questions: see [SECURITY.md](SECURITY.md), or open an issue at
<https://github.com/zyuuryuu/slidecraft/issues>.
