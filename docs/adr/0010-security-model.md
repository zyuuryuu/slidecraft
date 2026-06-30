# ADR-0010: セキュリティモデル（token 境界・loopback・no-fs/zip 硬化）

- **Status**: Accepted
- **Date**: 2026-06（P1/P2 着手時に決定・実装）

## Context
SlideCraft はローカルのデスクトップアプリ（Tauri v2）であり、信頼境界は **OS ユーザ**である。同一ユーザ権限で動くマルウェアは明示的にスコープ外とする（stdio MCP の前提と同じ）。一方で、自動呼び出し（MCP/CLI）や P2 のコラボレーション機能を足すと、これまで「人間がネイティブダイアログでパスを選ぶ」ことに依存していた前提が崩れ、攻撃面が開く。具体的に塞ぐべきだったのは次の通り。

- `src-tauri/src/lib.rs` の旧 `read_file` / `read_file_bytes` / `write_file` が**任意の絶対パスを無検証で `std::fs` に直渡し**しており、webview が侵害されれば任意ファイル読み書きプリミティブになっていた。
- `tauri.conf.json` の `csp: null`（CSP 未設定）。SVG/Mermaid XSS 硬化に対する多層防御が欠けていた。
- P2 で loopback リスナを導入すると、stdio の「待受面なし」姿勢が反転する。**loopback だけでは境界にならない**（同一マシンの別プロセスや、ポートを推測したタブが届きうる）。
- 入力 zip（`.slidecraft` / `.pptx` テンプレート）は untrusted で、zip bomb・過大サイズ・過大エントリ・過大スライド数のリスクがある。

## Decision
- **Token を実境界に置く（loopback リスナ）**: コラボリスナは `127.0.0.1` のみにバインドし（`0.0.0.0` を使わない）、**起動ごとに発行する 256bit bearer token**（base64url、永続化しない）を**唯一の信頼境界**とする。webview は Rust の plugin-http 経由で接続するため **Origin を持たない no-Origin クライアント**であり、Origin/CORS ではなく token が実際のゲートになる。比較は**定長 timing-safe**（`safeEqual`：長さ不一致時もダミー比較で早期 return しない）。
- **多層防御（防御の belt）**: 入場判定 `checkRequest` は順に (1) Host が loopback でなければ拒否（421）、(2) **Origin が「存在する場合のみ」allowlist で照合**し、不一致なら拒否（403／ブラウザの DNS-rebinding 対策）、存在しなければ通過、(3) token 照合（401）。Tauri webview の本番 Origin（`tauri://localhost` / `http(s)://tauri.localhost`）と dev Origin はコード上の**単一の真実**（`host-security.ts`）で管理し、OS 別の手当てを禁止する。
- **token ハンドシェイクファイル**: URL+token を `host.json` に **0600** で書く（POSIX は `chmod` で umask-proof）。起動ごとに rotate、終了時にクリア（Rust ホストが quit/stop で削除）。Windows の真の ACL ロックダウンは未実装（deferred）で、per-user プロファイルの既定 ACL ＋ rotation に依存。
- **no-fs / scoped-fs**: headless stdio MCP（`cli.ts serve`）は **`--no-fs` のみ**で、bytes は base64 で stdio を流れ、ファイルを一切読み書きしない。`--root`（scoped fs）は次バージョン予約（指定時は exit 2 で拒否）。MCP ツールとして `read_file`/`write_file` を**再公開しない**（engine 契約のみ公開）。
- **Tauri の fs 硬化**: 任意パスの `read_file`/`write_file` コマンドを**削除**し、scoped な `tauri-plugin-fs` ＋ dialog plugin に置換（ダイアログで選ばれたパスのみ実行時に fs スコープへ付与）。`csp: null` を廃し、`default-src 'self'` ベースの CSP を本番/dev 双方に設定（`connect-src` は ipc・Ollama・指定 AI API のみ許可）。
- **入力 zip 硬化** (`zip-safe.ts` / `project-io.ts`): 入力バイト数（100MB）とエントリ数（5000）を**展開前**にチェックし、各エントリは **stream 展開して上限超過の瞬間に中断**（宣言サイズの嘘に耐え、メモリを cap で抑える）。deck.json 32MB / template.pptx 128MB / 単一 XML 32MB の展開上限、`deck.json` は zod スキーマ検証、スライド数 **≤2000** を別途ガード。`meta.json` は非クリティカルで、壊れていてもデフォルトにフォールバックして開く。

## Consequences
- 自動呼び出し（MCP/CLI/コラボ）を足しても、OS ユーザ境界を超える新たな攻撃面を開かない。loopback ＋ token ＋ Origin belt の多層で、ポート推測・DNS-rebinding・他プロセスからの接続を弾く。
- untrusted な zip による DoS（zip bomb・メモリ枯渇・過大デッキ）をメモリ上限内で防ぐ。
- **同一ユーザ権限のマルウェアはスコープ外**。token ファイルを読めるプロセスはリスナに到達しうる（受容したトレードオフ）。Windows の `host.json` ACL ロックダウンは未実装（deferred）。
- **do-NOT-undo ガードレール**:
  - 任意パスの `read_file`/`write_file` を lib.rs・MCP ツールに**再導入しない**（scoped-fs ＋ dialog のみ）。
  - `csp` を `null` に戻さない。
  - リスナの bind を `0.0.0.0` にしない。token 照合を timing-safe 比較から外さない。Origin allowlist に「token の代わりにゲートさせる」依存を持たせない（あくまで belt）。
  - OS 別 Origin の手当てを `host-security.ts` の単一リストの外でやらない。
  - zip の展開上限・件数・スライド数ガードを緩めない（in-slide 画像対応時のみ意図的に調整）。

## References
- 設計: `docs/design/p2-collab-design.md`, `docs/mcp-server.md`, `docs/design/DesktopApp_DevelopmentDesign.md`
- コード: `src/mcp/host-security.ts`（token/`safeEqual`/`checkRequest`/Origin 単一リスト）, `src/mcp/host.ts`（127.0.0.1 bind・入場判定）, `src/mcp/host-json.ts`（0600 ハンドシェイク）, `src/mcp/cli.ts`（`--no-fs`）, `src/engine/zip-safe.ts`（stream 展開上限・件数・`ZIP_LIMITS`）, `src/engine/project-io.ts`（`assertDeckBounds`・スキーマ検証）, `src-tauri/src/lib.rs`（任意 fs コマンド削除→scoped plugin-fs）, `src-tauri/tauri.conf.json`（CSP）, `src-tauri/capabilities/default.json`（scoped fs/http 許可）
- 開発メモリ: `security_present_holes`（resolved）, `ai_integration_architecture`, `p1_mcp_server_design`
