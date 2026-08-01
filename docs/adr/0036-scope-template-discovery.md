# ADR-0036: `--root/templates/` テンプレ discovery — GUI 非依存クライアントの list_templates 可視性

- Status: Accepted（2026-07-23）
- Date: 2026-07-23

## Context

テンプレ調達ツール `list_templates` / `use_template`（[ADR-0033](0033-mcp-single-control-plane.md) 系・#298）は、
テンプレの実体（バイト列）を **GUI（webview）の master レジストリ**が保持し、それを host 専用ツール
`register_templates` が host プロセスへ投入する設計になっている。stdio 単体接続（Cursor・Claude Code CLI）には
この投入元となる GUI が存在しないため、`list_templates` は**組み込みプリセット（現状 `midnight` の1件）しか
返せない**。#298 でこれを `template-registry-unavailable` エラーから builtin フォールバックに直したが、
**ユーザー自身の `.potx` テンプレには依然到達できない**（実機フィードバック #324・Cursor 単体接続）。

`register_templates` の非公開（AI ロールに隠す）は、GUI マスターレジストリの一貫性・競合更新防止のための
**意図的な設計判断**であり、覆すべきではない。一方 [ADR-0035](0035-mcp-bulk-data-exchange.md) の `--root <dir>`
scope は、`new_project(templatePath)` で **レジストリを経由せず** scope 配下のテンプレを直接渡せる回避策を既に
提供している。ただしこれは「ファイル名を事前に知っている」前提で、「今どんなテンプレがあるか」を**選択肢として
提示させる**手段が stdio 単体には無い。

## Decision

**`--root` 起動時、`list_templates` が `<root>/templates/*.{pptx,potx}` を規約ディレクトリとしてスキャンし、
組み込みプリセットに合流させる。** `use_template` は `file:` 始まりの id を対応する scope 配下ファイルから起票する。

- **独立経路として共存**：GUI の `register_templates` レジストリと scope scan は独立。`--root` は **solo モード時
  のみ有効**（live host へ forward 中は `cli.ts` が無効化）＝両者が同時に効く状況は無いので、マージ規約は不要。
  GUI 接続時は従来どおりレジストリを返す（scope scan は行わない）。
- **専用サブディレクトリ**：`export_pptx`/`save_project` は `<root>` 直下へ `.pptx`/`.scft` を書くため、直下
  スキャンでは出力デッキがテンプレに紛れる。`templates/` サブディレクトリに封じてこれを避ける。ディレクトリ名は
  **リテラル固定**（呼び出し側制御でない）＝traversal 面を増やさない。
- **既存ハードニングの踏襲**：`file:` の読み取りは `fs-scope.ts` の read 経路（`new_project(templatePath)` と同一）を
  再利用＝ベア名のみ・拡張子 allowlist（`.pptx`/`.potx`）・symlink 非追従（`O_NOFOLLOW`＋事前 `lstat`）・
  `../`／絶対パス／サブディレクトリ拒否。listing 側も symlink を列挙しない（`Dirent.isFile()` が false）。
- **Never-silent 案内（提案2）**：discovery が空（builtin のみ）の単独起動では、`list_templates` の返り値に `note`
  を添え、「`--root/templates/` に `.pptx`/`.potx` を置く／`new_project(templatePath)` で直接指定」と回避策を示す。

### `register_templates` の AI 公開は不採用

上記 discovery で「自分のテンプレを AI に選ばせる」体験が GUI マスターレジストリの一貫性を崩さずに得られるため、
`register_templates` を AI ロールへ公開する案（提案3）は **不採用/優先度低**とする。

### 不変条件 / 硬化

- fs アクセスは **scoped dir 配下限定**（[ADR-0035](0035-mcp-bulk-data-exchange.md) 継承）。read no-follow の
  芯は `readScopedFile` と `readScopedTemplate` で**一本化**（R8：意味の重複を作らない）。
- **engine 純度（R2）維持**：readdir／read は `src/mcp/fs-scope.ts` に閉じ、`src/engine/*` には持ち込まない。
- **`--no-fs`（base64）既定・GUI レジストリ経路は非破壊で温存**（既存クライアント保護・回帰なし）。

## Consequences

- (+) GUI 非依存の利用（Cursor・Claude Code CLI 単体）でも、`--root` さえ張れば「自分のテンプレ一覧を選ばせる」
  体験が GUI 利用時と同等になる。
- (+) `register_templates` の意図的な非公開（GUI 一貫性）を**変えずに**同等の体験を提供。
- (+) 既存 `templatePath` 読み込み経路と `fs-scope.ts` ガードを再利用＝新規攻撃面を最小化。
- (−) scope に新しい列挙面（`templates/` の readdir）を1つ足す。ただしディレクトリ名は固定・symlink 非列挙・
  read は既存 no-follow 芯を共有。
- **[ADR-0035](0035-mcp-bulk-data-exchange.md) の scoped-fs モデルを拡張**（read 面に `templates/` discovery を追加）。

## References

- [ADR-0035](0035-mcp-bulk-data-exchange.md)（scoped fs `--root`・fs chokepoint）・
  [ADR-0033](0033-mcp-single-control-plane.md)（単一管制・template 調達）・
  [ADR-0007](0007-mcp-server-design.md)／[ADR-0010](0010-security-model.md)（no-fs／scoped・token 境界）
- 触点：`src/mcp/fs-scope.ts`（`listScopedTemplates`／`readScopedTemplate`／`SCOPED_TEMPLATES_SUBDIR`）・
  `src/mcp/templates.ts`（`listTemplates`／`resolveSoloTemplate`／`scopedTemplateInfos`）・
  `src/mcp/server.ts`（`list_templates`／`use_template` wiring）
- テスト：`tests/mcp-fs-scope.test.ts`（discovery/read ハードニング）・`tests/mcp-scoped-templates.test.ts`
  （MCP 経由の list/use 統合）
- 契機：#324（実機フィードバック・Cursor 単体でテンプレ不可視）
