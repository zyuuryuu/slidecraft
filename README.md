# SlideCraft

**Markdown をあなたの会社テンプレートに流し込んで、整った PowerPoint を作るデスクトップアプリ。**
フォントもレイアウトも崩さず、図も表も**編集可能な PPTX** として出力します。

> 📖 使い方は **[ドキュメントサイト](https://zyuuryuu.github.io/slidecraft/)** へ —
> [インストール](https://zyuuryuu.github.io/slidecraft/guide/installation.html)・
> [スターター](https://zyuuryuu.github.io/slidecraft/guide/getting-started.html)・
> [Markdown](https://zyuuryuu.github.io/slidecraft/guide/markdown-authoring.html)・
> [図](https://zyuuryuu.github.io/slidecraft/guide/diagrams.html)・
> [AI設定](https://zyuuryuu.github.io/slidecraft/guide/ai-setup.html)・
> [MCP](https://zyuuryuu.github.io/slidecraft/guide/mcp.html)・
> [FAQ](https://zyuuryuu.github.io/slidecraft/guide/faq.html)

Tauri v2 + React + TypeScript で構築。**Apache-2.0**。

## なぜ SlideCraft か

「Markdown でスライドを書く」ツールは他にもあります。SlideCraft が違うのは、**あなたの会社テンプレートの見た目を一切崩さず、編集可能な本物の PowerPoint を、最小の計算量で作る**ところです。

- 🎯 **テンプレに流し込む、崩さない** — 既存 `.pptx` テンプレのプレースホルダに Markdown を流し込む。フォント・配色・レイアウト・マスター装飾はそのまま。
- ✏️ **画像じゃない、編集できる図形** — 図・表・ダイアグラムは**ネイティブな PPTX シェイプ**として出力。受け取った人が PowerPoint でそのまま手直しできます。
- 🧠 **配置は決定論エンジンが整える** — レイアウトはテンプレの役割から自動選択（**どんなマスターでも動く**）、本文は容量内に収め、あふれはフォントを縮めず自動分割、配色はコントラスト保証。
- ⚡ **計算量は必要最小限、品質は保証** — 整形・配置・検証を決定論エンジンが担うので、AI に必要なのは Markdown を書くことだけ。**小さなローカルモデルで足り、トークンも最小**。AI 出力は適用前に採用ゲートで検証（*harness over model*）。
- 👁 **プレビュー＝出力** — プレビュー・PPTX・HTML が**同じ描画エンジン**を共有。「プレビューと本番が違った」がありません。
- 📊 **12 種のネイティブ図＋Mermaid** — フローチャート・ガント・KPI・レーダー…を数行の YAML から編集可能な図形で。
- 🔒 **ローカルファースト＋AI** — デスクトップ＋内蔵オフライン AI（llamafile）。データは手元に。上流 AI に [MCP](https://zyuuryuu.github.io/slidecraft/guide/mcp.html) で駆動させることも。

## インストール

### エンドユーザ（配布版）

- **macOS（Apple Silicon）** — Homebrew tap 経由が最もクリーンです（`brew` が quarantine を剥がすので、ad-hoc 署名でも初回警告なしで開けます）:

  ```bash
  brew install --cask zyuuryuu/slidecraft/slidecraft
  ```

  直接 `.dmg` を落とした場合は初回のみ Finder で右クリック →「開く」、または `xattr -dr com.apple.quarantine /Applications/SlideCraft.app`。Intel Mac 版は現在未提供です。
- **Windows / Linux** — [Releases](https://github.com/zyuuryuu/slidecraft/releases) から `.msi` / `.exe`（Windows）・`.AppImage` / `.deb` / `.rpm`（Linux）を取得。

詳しくは [インストールガイド](https://zyuuryuu.github.io/slidecraft/guide/installation.html)。

### 開発（ソースから）

前提: Node.js 20+ ／ Rust 1.70+ ／ Linux は `libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev patchelf`。

```bash
git clone git@github.com:zyuuryuu/slidecraft.git
cd slidecraft && npm install
npm run tauri dev    # Tauri + Vite を同時起動（npm run dev はブラウザ demo）
```

## 開発コマンド

```bash
npm test             # ユニットテスト (Vitest)
npm run typecheck:mcp # MCP レイヤの型チェック（app build は src/mcp を除外）
npm run lint         # ESLint
npm run test:e2e     # E2E (Playwright)
npm run build        # フロントエンドビルド (tsc + vite)
npm run tauri build  # インストーラ生成
npm run docs:dev     # ドキュメントサイト (VitePress) をローカルで
```

貢献方法・コーディング規約は [開発・貢献ガイド](https://zyuuryuu.github.io/slidecraft/guide/contributing.html) を参照。

## プロジェクト構成

```text
src/
  engine/            # 純粋ロジック (DOM/Tauri API 依存なし)
    diagram-painter.ts # 共有 painter (プレビュー SVG ＝ PPTX ネイティブ図形)
    placeholder-filler.ts # Markdown→PPTX テンプレ流し込み
    template-writer.ts # TemplateSpec → テンプレ PPTX 生成
    …
  components/        # React UI ／ ipc/ # Tauri IPC ／ mcp/ # MCP サーバ
src-tauri/           # Rust バックエンド（sidecar・keychain・モデルDL）
tests/ · tests/e2e/  # Vitest ／ Playwright
docs/                # ドキュメントサイト (VitePress)・ADR・設計
public/templates/    # スライドマスター (.pptx)
```

## 技術スタック

Tauri v2 (Rust) ／ React 19 + TypeScript 5.9 ／ Vite 8 ／ CodeMirror 6 ／ 共有 painter（ネイティブ図形 SVG）＋一部 Mermaid.js ／ PptxGenJS ／ Zod ／ Tailwind CSS 4 ／ Vitest + Playwright ／ 内蔵 AI = llamafile。

## ドキュメント

- 📖 **[ドキュメントサイト](https://zyuuryuu.github.io/slidecraft/)** — 使い方（インストール・スターター・Markdown・図・テンプレート・AI・MCP・FAQ）
- [SKILL.md](SKILL.md) — 上流 AI 向けの利用スキル（MCP 経由でデッキを著作する手順・契約）
- [MCP サーバ仕様](docs/mcp-server.md) — 全ツール・リソース・エラー契約
- [アーキテクチャ決定記録 (ADR)](docs/adr/) ／ [ロードマップ](docs/ROADMAP.md) ／ [実装済みログ](docs/shipped.md) ／ [詳細設計](docs/design/)
- [リリース手順](RELEASING.md) — バージョニング方針とリリース手順

## ライセンス

**Apache License 2.0** — 全文は [LICENSE](LICENSE)。第三者コンポーネント・同梱バイナリ・
実行時にダウンロードする AI モデル重みの帰属表示は [NOTICE](NOTICE) ／ [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照。
