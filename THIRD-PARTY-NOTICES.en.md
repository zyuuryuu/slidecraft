**English** · [日本語](THIRD-PARTY-NOTICES.md)

# Third-Party Notices

SlideCraft (Apache-2.0) uses and bundles the following third-party components, and at runtime
downloads AI model weights. Each component is under its respective license, and their copyright
notices and permission notices are reproduced here (including the attribution requirement of
Apache-2.0 §4(d)). This NOTICE is for informational purposes and does not modify the main
license (LICENSE).

---

## 1. npm Dependencies (Frontend / Engine / MCP)

The production dependencies (`--omit=dev`) comprise **273 components**, all under permissive licenses:

| License | Count |
| --- | --- |
| MIT | 209 |
| ISC | 39 |
| BSD-3-Clause | 8 |
| Apache-2.0 | 7 |
| MIT OR Apache-2.0 / Apache-2.0 OR MIT | 4 |
| Unlicense / 0BSD | 3 |
| Python-2.0 | 1 |
| BSD-2-Clause | 1 |
| MPL-2.0 OR Apache-2.0 (Apache-2.0 selected) | 1 |

Principal direct dependencies: `react` / `react-dom` (MIT), `@modelcontextprotocol/sdk` (MIT), `@anthropic-ai/sdk`, `openai` (Apache-2.0), `mermaid` (MIT), `pptxgenjs` (MIT), `jszip` (MIT or GPLv3 → MIT selected), `js-yaml` (MIT), `zod` (MIT), `@codemirror/*` (MIT), `tailwindcss` (MIT), `@tauri-apps/*` (MIT/Apache-2.0).

- The complete dependency list (with versions and licenses) can be generated with **`npm run sbom`** (CycloneDX SBOM = `sbom-npm.cdx.json`).
- For the Apache-2.0 npm components (7 of them), the NOTICE accompanying each is reproduced in this file as a substitute for the NOTICE within their distribution.
- The former "1 component with undetermined license" has been identified and resolved as **`khroma@2.1.0`** (a transitive dependency of `mermaid`). Because its `package.json` has no `license` field (an omission by the author), no automatic SPDX determination was assigned; however, the bundled `license` file contains the full text of the MIT license (Copyright © Fabio Spampinato, Andrew Maney) and its readme also explicitly states "MIT" ⇒ counted as **MIT** (included in the MIT row of the table above).

## 2. Rust Crates (Tauri Backend)

The direct dependencies of `src-tauri`: `tauri` and `tauri-plugin-{dialog,fs,http}`, `serde`, `serde_json`, `reqwest`,
`keyring`, `sha2`, `sysinfo` (all primarily dual-licensed as **MIT or Apache-2.0**).

- The complete list including transitive crates, together with the full license texts, will be generated with `cargo about generate` (or `cargo license`) at release time to produce
  `THIRD-PARTY-RUST.txt`, which will be attached (procedure for the initial release: RELEASING.md).

## 3. Bundled Binaries (externalBin Sidecars)

- **llamafile** `0.10.3` (Mozilla-Ocho / Justine Tunney and others) — **Apache-2.0**. Internally contains **llama.cpp** (Georgi Gerganov and others, **MIT**). Bundled as the built-in offline AI runtime (`scripts/stage-llamafile.mjs`, pinned + SHA256 verification).
- **Node.js** (bundled via `scripts/stage-node.mjs`) — **MIT**, along with the licenses of the various components included in Node.js (V8 = BSD, ICU = Unicode, OpenSSL, etc.). Used to run the collaboration host (MCP sidecar).

## 4. AI Model Weights (Downloaded at Runtime, Not Bundled)

When the built-in AI is enabled, the following GGUF weights are fetched from HuggingFace according to the selected tier (they are not included in the installer):

- **Phi-3.5-mini-instruct** (Microsoft) — **MIT**. Source GGUF: `bartowski/Phi-3.5-mini-instruct-GGUF` (quantized by bartowski).
- **Granite 4.1 8B** (IBM) — **Apache-2.0**. Source GGUF: `unsloth/granite-4.1-8b-GGUF` (quantized by unsloth).

Use of each model is subject to the license and terms of use of the original model.

## 5. Bundled Slide Templates

See `public/templates/slide/CREDITS.md` (e.g., `lrk-slides-velis_CC0.pptx` = "lrk-slides-velis" by Laurens R. Krol, **CC0 1.0**).

---

For the full text of each license, refer to `node_modules/<pkg>/LICENSE` for npm packages, crates.io for Rust crates,
and the respective distribution sources for llamafile/llama.cpp/Node/models. If any doubt arises, update this file before release.
