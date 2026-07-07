# ADR-0024: `.scft` 拡張子への短縮とアプリ関連付け（ダブルクリックで開く）

- Status: Accepted
- Date: 2026-07-07
- Deciders: SlideCraft maintainers

## Context

SlideCraft のプロジェクトファイル（デッキ＋テンプレートを 1 ファイルに同梱した zip）は当初 `.slidecraft`（10 文字）を拡張子にしていた。これを OS にアプリ関連付けし、ファイルを**ダブルクリック / 「プログラムから開く」で SlideCraft が開く**ようにしたい、というユーザ要望。あわせて拡張子が長い点も指摘された。

論点は 2 つ:

1. **拡張子名**：`.slidecraft` は長く手打ちしづらい（ただしダブルクリック運用なら実害は小さい）。まだ初回リリース直後（v0.2.0）で野良ファイルは事実上皆無 ⇒ 改名コストが最小の今しか変えられない（後からの改名は既存ファイルを孤立させる不可逆判断）。
2. **関連付け＋起動時オープンの実装**：OS ごとに口が違う。Windows/Linux は起動プロセスの **argv** でパスが来る。macOS は argv ではなく **Apple の「open documents」イベント**（Tauri の `RunEvent::Opened`）で来る。さらに**アプリ起動中**にもう 1 つ開いた場合、Windows/Linux は素朴には二重起動する。

## Decision

**(1) 拡張子を `.scft`（4 文字）へ改名。** 慣用的な 3–4 文字レンジで、SlideCraft の頭字語。唯一の定義箇所として `PROJECT_EXT = "scft"` と `projectTitleFromFileName()` を `project-io.ts` に置き、ピッカー・保存名・起動時オープンが**同じ 1 箇所**を参照する（drift 防止）。

**(2) 関連付けは `bundle.fileAssociations`（`tauri.conf.json`）で宣言。** `ext:["scft"]` / `role:"Editor"`（macOS）/ `mimeType:"application/x-slidecraft"`（Linux）。これで Windows レジストリ・macOS `CFBundleDocumentTypes`/UTI・Linux MIME がインストーラで登録される。

**(3) 起動時オープンは「OS が渡したパスを Rust が受け取り、fs スコープにそのパスだけ許可して queue、webview は queue を drain して scoped plugin-fs で読む」設計**（`src-tauri/src/file_open.rs`）:

- **信頼境界**：webview は**任意パスを渡さない**。パスは常に OS 起動（ユーザ操作）由来で Rust の `PendingOpen` に入り、`fs_scope().allow_file(path)` で**そのファイルだけ**読める（ダイアログ選択と同じ動的付与）。既存の「任意 fs read 穴は塞いだ」不変条件を壊さない。
- **Windows/Linux（コールド）**：`setup()` で `std::env::args()` を走査し `.scft` を queue。
- **macOS（コールド＋ウォーム）**：`RunEvent::Opened { urls }`（macOS 限定 cfg）で file URL → パス → queue。
- **Windows/Linux（ウォーム）**：`tauri-plugin-single-instance` を**最初に**登録し、2 度目の起動 argv を**既存インスタンスへ**転送（二重起動しない）。
- **drain が真実、event は起こすだけ**：Rust は queue へ push 後 `scft://open-file` を emit。webview は**マウント時**（コールド）と**event 受信時**（ウォーム）の両方で `take_pending_opens` を呼び drain。queue は最初の drain で空になるため、シグナルが重なっても各ファイルは**ちょうど 1 回**開く。

## Consequences

- **ダブルクリックで開く**：起動済みなら**新しいタブ**として開き、現在の作業を壊さない（`openDoc` 経由＝マルチドキュメント基盤に乗る）。ウィンドウは前面化（`unminimize`＋`set_focus`）。
- **単一定義**：`.slidecraft` 直書きの取りこぼしを `projectTitleFromFileName` の純粋テストでガード（`tests/project-filename.test.ts`）。エラーメッセージ文言も `.scft` に追随（`tests/project-io.test.ts` の reject 正規表現を `/scft/` に更新）。
- **`single-instance` 依存追加**：desktop 限定ターゲット（`cfg(not(android|ios))`）でのみ引き込む。webview 向けコマンドを持たない init-only プラグインなので capability 追加は不要。`take_pending_opens` もカスタムコマンド（collab 等と同様に capability 不要）。
- **ブラウザ（dev/demo）は無影響**：`src/ipc/file-open.ts` の各関数は `runningInTauri()` で no-op。
- **既知の残**：`.scft` 形式のバージョニング（前方互換保険＝deck に schema version を埋める）は別課題（ROADMAP）。macOS の UTI を独自宣言していないため、他アプリが同 UTI を主張した場合の優先順位は OS 任せ。

## References

- `src/engine/project-io.ts`（`PROJECT_EXT` / `projectTitleFromFileName`）
- `src/ipc/file-open.ts`・`src/components/useDeckIO.ts`（`handleOpenProjectFile`）・`src/App.tsx`（drain＋event の effect）
- `src-tauri/src/file_open.rs`・`src-tauri/src/lib.rs`（single-instance＋`RunEvent::Opened`＋setup argv）
- `src-tauri/tauri.conf.json`（`bundle.fileAssociations`）・`src-tauri/Cargo.toml`（`tauri-plugin-single-instance`）
- `tests/project-filename.test.ts`・`tests/project-io.test.ts`
