[English](THIRD-PARTY-NOTICES.en.md) · **日本語**

# Third-Party Notices

SlideCraft（Apache-2.0）は以下の第三者コンポーネントを利用・同梱し、また実行時に AI モデル重みを
ダウンロードします。各コンポーネントはそれぞれのライセンスの下にあり、その著作権表示・許諾表示を
ここに再現します（Apache-2.0 §4(d) の attribution 要件を含む）。この NOTICE は情報提供目的であり、
本体のライセンス（LICENSE）を変更しません。

---

## 1. npm 依存（フロントエンド／エンジン／MCP）

本番依存（`--omit=dev`）は **275 コンポーネント**、いずれも permissive ライセンス：

| ライセンス | 数 |
| --- | --- |
| MIT | 211 |
| ISC | 39 |
| BSD-3-Clause | 8 |
| Apache-2.0 | 7 |
| MIT OR Apache-2.0 / Apache-2.0 OR MIT | 4 |
| Unlicense / 0BSD | 3 |
| Python-2.0 | 1 |
| BSD-2-Clause | 1 |
| MPL-2.0 OR Apache-2.0（Apache-2.0 を選択） | 1 |

主な直接依存：`react` / `react-dom`（MIT）・`@modelcontextprotocol/sdk`（MIT）・`@anthropic-ai/sdk`・`openai`（Apache-2.0）・`mermaid`（MIT）・`pptxgenjs`（MIT）・`jszip`（MIT or GPLv3 → MIT を選択）・`js-yaml`（MIT）・`zod`（MIT）・`@codemirror/*`（MIT）・`tailwindcss`（MIT）・`@tauri-apps/*`（MIT/Apache-2.0）・`harfbuzzjs`（MIT — HarfBuzz `hb-subset` の WASM ビルド、実行時 CJK フォントサブセット化、#193）・`wawoff2`（MIT — WASM 版 WOFF2 エンコーダ/デコーダ、#193）。

- 完全な依存リスト（バージョン・ライセンス付き）は **`npm run sbom`**（CycloneDX SBOM＝`sbom-npm.cdx.json`）で生成できる。
- Apache-2.0 の npm コンポーネント（7件）に付属する NOTICE は、その配布物内の NOTICE として本ファイルが代替再現する。
- 旧「ライセンス未判定 1件」は **`khroma@2.1.0`**（`mermaid` の推移的依存）と特定・解決済み。`package.json` に `license` フィールドが無い（作者の記載漏れ）ため自動 SPDX 判定が付かなかったが、同梱の `license` ファイルは MIT 全文（Copyright © Fabio Spampinato, Andrew Maney）で readme も "MIT" と明記 ⇒ **MIT** に計上（上表 MIT に含む）。

## 2. Rust クレート（Tauri バックエンド）

`src-tauri` の直接依存：`tauri` および `tauri-plugin-{dialog,fs,http}`・`serde`・`serde_json`・`reqwest`・
`keyring`・`sha2`・`sysinfo`（いずれも **MIT または Apache-2.0** のデュアルライセンスが主）。

- 推移的クレートを含む完全なリスト＋ライセンス本文は、リリース時に `cargo about generate`（または `cargo license`）で
  `THIRD-PARTY-RUST.txt` を生成して添付する（初回リリースの手順・RELEASING.md）。

## 3. 同梱バイナリ（externalBin サイドカー）

- **llamafile** `0.10.3`（Mozilla-Ocho / Justine Tunney ほか）— **Apache-2.0**。内部に **llama.cpp**（Georgi Gerganov ほか・**MIT**）を含む。内蔵オフライン AI ランタイムとして同梱（`scripts/stage-llamafile.mjs`・pinned＋SHA256 検証）。
- **Node.js**（`scripts/stage-node.mjs` で同梱）— **MIT** および Node.js に含まれる各コンポーネントのライセンス（V8＝BSD、ICU＝Unicode、OpenSSL 等）。協働ホスト（MCP サイドカー）実行用。

## 4. AI モデル重み（実行時ダウンロード・非同梱）

内蔵 AI を有効化すると、選択ティアに応じて以下の GGUF 重みを HuggingFace から取得する（インストーラには含まれない）：

- **Phi-3.5-mini-instruct**（Microsoft）— **MIT**。取得元 GGUF：`bartowski/Phi-3.5-mini-instruct-GGUF`（量子化 by bartowski）。
- **Granite 4.1 8B**（IBM）— **Apache-2.0**。取得元 GGUF：`unsloth/granite-4.1-8b-GGUF`（量子化 by unsloth）。

各モデルの利用は元モデルのライセンス・利用規約に従う。

## 5. 同梱スライドテンプレート

`public/templates/slide/CREDITS.md` を参照（例：`lrk-slides-velis_CC0.pptx` = "lrk-slides-velis" by Laurens R. Krol・**CC0 1.0**）。

---

各ライセンスの全文は、npm パッケージは各 `node_modules/<pkg>/LICENSE`、Rust クレートは crates.io、
llamafile/llama.cpp/Node/モデルは各配布元を参照。疑義があればリリース前に本ファイルを更新すること。
