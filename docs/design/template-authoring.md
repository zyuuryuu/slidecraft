# テンプレ作成補助 — 詳細設計（ROADMAP テーマ2）

2026-07-04 設計確定（ユーザ合意済み）。ROADMAP テーマ2「テンプレ作成補助 — 新テンプレの作成/登録支援。
原稿→マスター整形と重なる最大機能」（サイズ L）の実施設計。

## スコープ（確定事項）

| 決定 | 内容 |
| --- | --- |
| 対象 | **登録支援＋新規生成の両方**を1つの「テンプレ作成補助」体験として実装 |
| 生成方式 | **ゼロから生成**（マスター/レイアウト/テーマ XML のフル生成）。re-theme（canonical パッチ）方式は採らない |
| 着手順 | **登録支援（修復パイプライン）から**。生成は後続スライス |
| 永続化 | レジストリ永続化（バックログ「テンプレ管理」相当）を**テーマ2のスコープに含める** |

## 背景 — 現状の非対称性

アプリには堅牢な「読む側」が既にある:
`loadTemplate`（`src/engine/template-loader.ts`）→ `buildCatalog` → 受け入れゲート
`assessTemplateHealth`（`src/engine/template-catalog.ts`）。型剥奪・欠番・重複 idx・alien テンプレへの
回復ラダーとテスト群（`tests/master-intake.test.ts` ほか）も完備。

一方「書く側」は開発用 CLI `scripts/rebuild-template.ts`（canonical の 30 レイアウト×`PhDef` 定義を
パッチ再生成）だけで、**アプリ内にマスターを生成・修復・書き出す機能は存在しない**。テーマ2はこの
空白を埋める。読む側は生成/修復物の**検証ゲートとしてそのまま再利用**する（round-trip 保証）。

## スライス構成（着手順）

| # | 内容 | サイズ | 状態 |
| --- | --- | --- | --- |
| S1 | **登録支援（修復）エンジン** `template-repair.ts`：rejected テンプレの診断→修復提案→XML パッチ | M | 完了 |
| S2 | 取り込み UI 配線：インポート時に健全性レポート＋「整形して取り込む」 | S | 完了 |
| S3 | **template-writer エンジン**：`TemplateSpec` → フル OOXML 生成（マスター/レイアウト/テーマ/配管） | L | 完了（engine＋テスト。PowerPoint 実機確認は S4 マイルストーン時に手動） |
| S4 | テンプレ作成 UI：スペック編集 → 生成して適用（メインプレビューが即時反映＝ライブ確認）→ 登録 | M | 完了（Playwright E2E 検証済。埋め込みプレビュー/レイアウトサブセット UI は後続） |
| S5 | AI スペック提案：自然言語/原稿 → `TemplateSpec`（ADR-0005 準拠 = AI は提案のみ、書くのは決定論コード） | S〜M | 完了（`template-spec-prompts.ts`＝防御的パース＋コントラストガード、AiMode `template-spec`、モーダル「✨AI におまかせ」。スタブ AI で E2E 検証済） |
| S6 | レジストリ永続化（Slice 1b）：`useMasterRegistry` を同一インターフェースで Tauri app-local-data へ | M | 完了（`src/ipc/master-store.ts`。Tauri 実機 E2E はマイルストーン時に手動確認） |

## S1/S2 — 登録支援（修復パイプライン）

現状、`NO_TITLE_ROLE` / `NO_BODY_ROLE` の block を持つテンプレは `rejected` で門前払い
（`apply-template.ts` が parseError 表示のみ）。これを「拒否」から「修復提案」へ:

- `src/engine/template-repair.ts`（純粋ロジック・R2）
  - `planRepairs(tpl: TemplateData): RepairPlan` — catalog/health を評価し、block を解消する
    `RepairOp[]`（対象レイアウト・対象 placeholder・付与する type・日本語の理由）を決定論的に提案
  - `applyRepairs(bytes, ops): Promise<Uint8Array>` — 対象レイアウト XML の `<p:ph>` に type 属性を
    付与する**最小パッチ**（他のエントリは無改変）
  - `repairTemplate(bytes): { bytes, plan, healthAfter }` — 診断→パッチ→再評価の一括便宜 API
- **候補推定ラダー**（role="other" の placeholder が対象。既存の回復ラダーで拾えなかった残渣のみ）:
  1. title 候補: フォントサイズ最大（マスター継承で残る唯一の信号。≥18pt を要求）、同点は
     ジオメトリ上位（y 最小）→ 文書順
  2. body 候補: 残りから面積最大（ジオメトリ無しなら文書順先頭）
- **ターゲット照合ラダー**（パッチ適用時）: `idx` 属性一致 → shape 名一致 → placeholder 序数
- **不変条件**: 修復後の再ロードで `rejected` が解消されること（テストで担保）。提案が block を
  解消できない場合は `repairable: false` を返し、従来どおり拒否
- UI（S2）: `applyTemplateBytes` が rejected 時に修復プランを返し、`App.handleImportMaster` が
  確認ダイアログ（Tauri plugin-dialog / browser confirm）で「整形して取り込む」→ **修復済み bytes**
  をレジストリ登録＋適用

## S3 — template-writer（ゼロから生成）

- 入力 `TemplateSpec`: 名前・配色パレット（テーマ 12 スロット＋装飾色）・フォント（major/minor）・
  レイアウト定義列（`rebuild-template.ts` の `PhDef` 相当を engine 型に昇格）。canonical の 30 レイアウト
  定義を**組み込みレイアウトライブラリ**として同梱し、スペックはそこから選択/改変できる
- 出力: template-only PPTX（`[Content_Types].xml`・`_rels`・`presentation.xml`・`slideMaster1.xml`＋rels・
  `slideLayoutN.xml`＋rels・`theme1.xml`）をフル生成
- **検証ゲート**: `loadTemplate(write(spec))` → `assessTemplateHealth` が `ok`、レイアウト/プレースホルダの
  ゴールデンテスト、既存 alien/intake 系の読み戻し回帰。PowerPoint 実機確認はマイルストーン時に手動
- リスク: OOXML 互換の検証コストが大きい（この方式はユーザ判断で確定済み）。互換問題が出た場合は
  最小 viable セット（single master・プレーン背景）から段階的に拡張する

## S5 — AI の役割（原稿→マスター整形との交点）

「雰囲気・用途の自然言語」または「原稿そのもの」から `TemplateSpec` を**提案**するのが AI の仕事。
原稿からは distill 系の解析（必要なレイアウト種・列数・図/表の有無）を流用してレイアウト構成を推定。
PPTX を書くのは常に決定論コード（ADR-0005「ハーネス over モデル」）。

## 非スコープ / 関連

- MCP への create/repair tool 公開はテーマ3（MCP ブラッシュアップ）で扱う（engine API は流用可能な形にする）
- テンプレ資産の棚卸（バックログ）は S6 永続化と同時に判断
- 既知の仕様: 表セル文字・図ノード文字はマスター body 書式に非追従（ROADMAP 記載・再調査不要）
