# ADR-0001: プロダクト形態＝Tauri デスクトップアプリ

- **Status**: Accepted
- **Date**: 2026-06（2026-06-21 に決定。以後 v5 まで実装継続）

## Context
SlideCraft は「ローカルの .md / テンプレート .pptx を入力し、.pptx を出力する」ファイル中心・機密性の高い（社外秘の意思決定資料がローカルに留まる）オフライン志向のツールである。AI 連携（テーマ #1）はローカルの API キーを直接利用したく、バックエンドを介したくない。これらの「ファイル／プライバシーの筋目」に対し、ホスト型 Web SaaS はホスティング・認証・キープロキシ基盤を要し逆行する。一方で、変換エンジン（`generatePptx`）はブラウザ互換の純粋ロジックであり、同一コードベースをデスクトップとブラウザ双方で動かせる。

## Decision
- 標準のプロダクト形態を **Tauri v2（Rust シェル + WebView）デスクトップアプリ**とし、インストーラ（msi / dmg / AppImage、`bundle.targets: "all"`）で配布する。識別子は `com.slidecraft.desktop`。
- 「Docker + localhost ブラウザ」は **開発／デモ専用**（WSL2 向けの高速ループ）と位置づけ、エンドユーザ向けの顔としては採用しない。
- **コードベースは分岐させない**。ファイル I/O は `src/ipc/commands.ts` で二層化（dual-mode IPC）し、`__TAURI_INTERNALS__` の有無で実行時に切替える。Tauri 時は `@tauri-apps/plugin-dialog`（ネイティブダイアログ）＋ `@tauri-apps/plugin-fs`（ダイアログで選ばれたパスのみスコープ許可される fs）を、ブラウザ時は File API（`<input type=file>` / Blob ダウンロード）をフォールバックとして使う。
- セキュリティ境界を明示：`tauri.conf.json` の CSP は `default-src 'self'`、`connect-src` は AI プロバイダのみ許可リスト化（Ollama `localhost:11434` / `api.anthropic.com` / `api.openai.com` / `openrouter.ai`）。capabilities は `fs:default` + dialog 経由パスのみ。HTTP は `tauri-plugin-http` で localhost / `https://**` に限定。

## Consequences
- ローカル完結・オフライン・プライバシー保持を満たし、AI 連携を「ローカルキー直叩き・バックエンドなし」で進められる（ADR の前提として後続テーマ #1 を解放）。
- 同一エンジンが Web デモとしても動くため、開発ループは軽量に保てる。
- ホスト型 Web 配布・サーバ集中処理は本決定の対象外（採らない）。
- **do-NOT-undo**: ブラウザフォールバックを撤去してコードベースを分岐させない／`src/engine/` を Tauri・DOM 非依存の純粋ロジックに保つ（ブラウザ実行性の前提）。
- 受容したトレードオフ：3-OS のビルド・配布運用が必要。**残課題**＝コード署名／公証（Win Authenticode・Apple notarization、ユーザ提供の証明書が前提）と Tauri Updater による自動更新は未実装。

## References
- 設計書: `docs/design/DesktopApp_DevelopmentDesign.md`（Tauri v2 シェル / IPC 設計 §6 / ビルド設定 §9）
- ロードマップ: `docs/ROADMAP.md`（P5「Tauri GUI + IPC」完了・P6 インストーラ完了 / v5 §・自動アップデート将来項）
- コード: `src/ipc/commands.ts`（dual-mode IPC）, `src-tauri/tauri.conf.json`（CSP・bundle）, `src-tauri/capabilities/default.json`（fs/dialog/http スコープ）, `src-tauri/Cargo.toml`（plugin-dialog/-fs/-http）, `.github/workflows/release.yml`
- 開発メモリ: `product_form_desktop`
