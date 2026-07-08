# Security Policy

## Supported versions

SlideCraft is an early (0.x) release with no LTS. Security fixes are made against the latest release
and `main`; older 0.x versions are not separately patched. Please use the most recent release.

| Version | Supported |
| --- | --- |
| Latest 0.x release + `main` | ✅ |
| Older 0.x | ❌ |

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues.**

Report privately through **GitHub's private vulnerability reporting** —
[open a private report](https://github.com/zyuuryuu/slidecraft/security/advisories/new)
(repository **Security → Advisories → "Report a vulnerability"**). Reports go only to the
maintainers; nothing is public until a fix is coordinated.

Please include: affected version, platform (Windows / macOS / Linux), a description of the issue, and
steps to reproduce (a minimal input deck / template is ideal). We aim to acknowledge reports within a
few days and will keep you informed as we work on a fix. Please give us reasonable time to release a
fix before any public disclosure.

## Scope and threat model

SlideCraft is a **local-first desktop app**. Its security posture is documented in
[ADR-0010 (security model)](docs/adr/0010-security-model.md) and
[ADR-0016 (security review)](docs/adr/0016-security-review-theme4.md). In brief:

- The renderer runs under a strict CSP (`default-src 'self'`); filesystem and network access are
  scoped, and the loopback collaboration server uses a per-launch bearer token.
- Untrusted input (Markdown, YAML, imported `.pptx`/`.potx` templates, pasted/dropped images) is
  treated as untrusted: images are constrained to `data:` URIs, exported HTML is nonce-CSP'd, and zip
  intake is hardened (size/entry limits).
- The optional offline AI (bundled llamafile) and MCP server run locally; model weights are fetched
  from pinned URLs verified by SHA-256. Nothing is sent to the cloud unless the user configures an
  external AI provider.

Reports about the integrity of released binaries or the signing process are also welcome — see
[CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).
