# ADR-0022: MCP CLI をアプリに同梱する（ビルド不要のエージェント駆動）

- Status: Accepted
- Date: 2026-07-07
- Deciders: SlideCraft maintainers

## Context

上流 AI（Claude Code / Cursor / Claude Desktop）から SlideCraft を駆動する MCP サーバ（`slidecraft serve` = `src/mcp/cli.ts`）は、これまで**ソースからのビルド専用**だった。配布物には含まれず、`brew install --cask` で入るのは GUI（`SlideCraft.app`）のみ。実ユーザから「brew で入れたが、エージェントから使うには MCP サーバをソースからビルドして登録する必要がある」と報告された（[[collab_host_model]] の北極星＝GUI ホスト＋外部 AI 接続はまだ外部エージェントの標準経路になっていない）。

障害は 2 つ:

1. **配布に含まれない** — cask は `app` のみ、`binary` なし。`slidecraft` コマンドも PATH に無い。
2. **`build:mcp` は自己完結でない** — `esbuild … --packages=external` で node_modules を**外部化**している。開発時はリポジトリの `node_modules` から解決できるが、アプリ内に `cli.js` だけ置いても依存が解決できず `MODULE_NOT_FOUND` で落ちる。同梱するには全依存を**内包**したバンドルが要る（`host.cjs` が既にそうしているのと同じ）。

エンドユーザに「clone + npm install + build」を課すのは、harness-over-model（[[product_philosophy_harness]]）で謳う「小さなモデルで、環境構築なしに」に反する。

## Decision

**自己完結した MCP サーバを配布インストーラに同梱し、macOS では PATH ランチャを提供する。**

1. **`build:mcp:bundled`** を追加：`esbuild … --format=cjs --target=node20 --outfile=dist/mcp/cli.cjs`（`--packages=external` なし＝全依存内包、`host.cjs` と同方式）。開発用の `build:mcp`（ESM・external）は**残す**（用途が違う）。
2. **Tauri リソース同梱**（全 OS）：`tauri.bundle.conf.json` の `resources` に `../dist/mcp/cli.cjs → cli.cjs` を追加。`beforeBuildCommand` に `build:mcp:bundled` を追加し、パッケージ前に必ず生成する。インストーラは既に **Node ランタイムを externalBin として同梱**しているので、`同梱node + cli.cjs` でシステム Node 不要。
3. **macOS PATH ランチャ**：`scripts/slidecraft-mcp`（POSIX sh）をリソース同梱し、cask の `binary` スタンザで PATH に載せる。ランチャは Homebrew の `bin` シンボリックリンク越しでも動くよう**自分の実パスを解決**（`readlink` ループ）してから、同梱 node（`../MacOS/node`）と `cli.cjs` を `exec` する。`postflight` で実行権限を担保。
4. **登録**：`claude mcp add slidecraft -- slidecraft-mcp`（brew/macOS）、または `同梱node + cli.cjs` の絶対パスを直接指定（macOS は検証済み、Windows/Linux はインストール先を要確認・未検証）。

## Consequences

- **v0.2.0 以降で有効**。同梱物は再ビルドが要るため、現在出荷済みの v0.1.0 では従来どおりソースビルドが必要。cask の `binary` スタンザは v0.2.0+ の .dmg にのみ載せる（wrapper を含まない .dmg を指す cask に付けると `brew install` が binary 不在で失敗するため、live tap は次リリースまで現状維持）。
- **PATH ランチャ（`slidecraft-mcp`）は v0.2.0 で macOS/Homebrew のみ**。Windows/Linux は同梱 node ＋ `cli.cjs` の直接登録になるが、**正確な絶対パスはインストーラ・バージョン依存で現状デバイス未検証**（アプリのバイナリ名は productName ではなく Cargo 名 `diagram-pipeline-desktop`。Linux `.deb`/`.rpm` はこの名前のディレクトリ配下の可能性が高いが未確認）。したがって Windows/Linux 直接パスはドキュメント上「未検証・インストール先を要確認」とし、不明ならソース版（B）を案内。AppImage は展開先が可変なため直接パス非推奨 → B。将来 Windows `.cmd` / Linux 相当の PATH shim ＋ 実機でのパス検証は follow-up。
- 自己完結 `cli.cjs` は約 2.5 MB（`host.cjs` と同オーダー）。依存は `host.cjs` の閉包の部分集合で、既に production でバンドル実績があるため低リスク。スモークテスト（`node cli.cjs` を素の cwd で起動 → MCP `initialize` 往復）で外部化ゼロを継続検証（`tests/mcp-cli-bundle.test.ts`）。
- 副次修正：`update-cask.mjs` が arm64-only（sha256 が 1 行）に非対応で次リリースで失敗する潜在バグを是正（1 行＝arm のみ、2 行＝arm+intel を許容）。
- 将来：GUI に「登録コマンドをコピー」ボタン（アプリが自分の resource/node 実パスを解決して提示）を出せば、直接パス方式のパス調べが不要になる。

## References

- `package.json`（`build:mcp:bundled`）, `src-tauri/tauri.conf.json`（beforeBuildCommand）, `src-tauri/tauri.bundle.conf.json`（resources）
- `scripts/slidecraft-mcp`（ランチャ）, `packaging/homebrew/Casks/slidecraft.rb`（binary/postflight）, `scripts/update-cask.mjs`
- `tests/mcp-cli-bundle.test.ts`
- ADR-0006/0007（MCP 設計）, ADR-0021（自動更新）
- docs/mcp-server.md「使い方は 2 通り」, docs/guide/mcp.md, docs/guide/installation.md
