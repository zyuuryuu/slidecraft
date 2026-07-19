**English** · [日本語](THIRD-PARTY-NOTICES.md)

# Third-Party Notices

SlideCraft (Apache-2.0) uses and bundles the following third-party components, and at runtime
downloads AI model weights. Each component is under its respective license, and their copyright
notices and permission notices are reproduced here (including the attribution requirement of
Apache-2.0 §4(d)). This NOTICE is for informational purposes and does not modify the main
license (LICENSE).

---

## 1. npm Dependencies (Frontend / Engine / MCP)

The production dependencies (`--omit=dev`) comprise **275 components**, all under permissive licenses:

| License | Count |
| --- | --- |
| MIT | 211 |
| ISC | 39 |
| BSD-3-Clause | 8 |
| Apache-2.0 | 7 |
| MIT OR Apache-2.0 / Apache-2.0 OR MIT | 4 |
| Unlicense / 0BSD | 3 |
| Python-2.0 | 1 |
| BSD-2-Clause | 1 |
| MPL-2.0 OR Apache-2.0 (Apache-2.0 selected) | 1 |

Principal direct dependencies: `react` / `react-dom` (MIT), `@modelcontextprotocol/sdk` (MIT), `@anthropic-ai/sdk`, `openai` (Apache-2.0), `mermaid` (MIT), `pptxgenjs` (MIT), `jszip` (MIT or GPLv3 → MIT selected), `js-yaml` (MIT), `zod` (MIT), `@codemirror/*` (MIT), `tailwindcss` (MIT), `@tauri-apps/*` (MIT/Apache-2.0), `harfbuzzjs` (MIT — WASM build of HarfBuzz's `hb-subset`, runtime CJK font subsetting, #193).

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

## 6. Bundled Fonts (source fonts for runtime CJK subsetting)

For runtime CJK font subsetting in HTML export (#193 / #115-b), the following variable fonts are
bundled under `public/fonts/`. They are the **source** fonts a deck's actually-used glyphs are cut
from — the app never distributes the full font sets directly (see `public/fonts/CREDITS.md`):

- **NotoSansJP-Variable.ttf** (Noto Sans JP, a variable font spanning `wght` 100–900) — © Google /
  Adobe (Source Han Sans lineage) — **SIL Open Font License 1.1**. Full license text in
  `public/fonts/OFL-NotoSansJP.txt`.
- **NotoSerifJP-Variable.ttf** (Noto Serif JP, a variable font spanning `wght` 200–900) — © Google
  (Source Han Serif lineage) — **SIL Open Font License 1.1**. Full license text in
  `public/fonts/OFL-NotoSerifJP.txt`.

Both are the unmodified original files fetched from Google's `google/fonts` repository
(`ofl/notosansjp/`, `ofl/notoserifjp/`). OFL 1.1 permits bundling, modification (subsetting), and
redistribution (only selling the font standalone is prohibited; the full license text must be
included). The template's actually-named font (Yu Gothic, 游明朝, a company's own font, etc.) is
never reproduced — this feature substitutes these bundled fonts based on the gothic/mincho
**classification** (`classifyCjkFont` in font-stack.ts), a design confirmed in the #115 discussion.

---

For the full text of each license, refer to `node_modules/<pkg>/LICENSE` for npm packages, crates.io for Rust crates,
and the respective distribution sources for llamafile/llama.cpp/Node/models. If any doubt arises, update this file before release.
