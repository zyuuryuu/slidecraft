# SlideCraft ロードマップ

前方向きの計画のみを記す。完了フェーズ（v1/v2/v4/v5・E1〜E6・閉ループ A〜C）の履歴は
**ADR と git に移管済み**。決定の記録は `docs/adr/` を参照。

現在地：P2 コラボ弧（AI↔人のライブ共同編集・push/pull 同期・共有 undo）まで検証済み。
配布/パッケージングは Windows セッションで進行中。完了後、下記テーマがリードとして戻る。

---

## 次の主要テーマ（優先順）

土台（テンプレ堅牢性）と差別化アーキ（内蔵 AI）は完了。残りは 磨き込み → 機能 の順。
詳細は開発メモリ `roadmap_post_p2` 参照。

| # | テーマ | 一行 | サイズ |
|---|--------|------|-------|
| 1 | **プロンプト磨き込み（残課題）** | AI 生成品質の底上げ。**構造ヘッダー保全は完了**（[ADR-0012](adr/0012-ai-edit-structure-preservation.md)）。残りは下記 | M |
| 2 | **HTML 出力**（大マイルストーン） | 磨き込んだ Web preview をスタンダロン HTML プレゼンとして出力 | L |
| 3 | **テンプレ作成補助** | 新テンプレの作成/登録支援。原稿→マスター整形と重なる最大機能 | L |

> **テーマ1「プロンプト磨き込み」の状況**：
>
> - **構造ヘッダー保全 → 完了**（[ADR-0012](adr/0012-ai-edit-structure-preservation.md)）。決定論ハーネス
>   `reconcileEdit`＋`validateStructure` を前景/batch/refine の全経路に配線し、AI が落とした layout/title/
>   meta/図/表/コードを復元。プロンプト側は不変条件ブロック＋A/B 決定木＋few-shot（保証は決定論ゲート側）。
> - **残課題（プロンプト/生成品質）**：(1) 前景/batch で数値改変・言語ドリフトを止める決定論ガードが無い（プロンプト
>   抑止のみ／前景に SOFT 数値警告を足す余地）。(2) `slideSystemPrompt`（手動コピー用）のレイアウト名ハードコード
>   → カタログから動的化（alien master 対応、guardrail_any_template）。(3) diagram/diagram-edit プロンプトの出力
>   純度・ノード id 保全・type 許容集合の不一致。(4) 空 section 連発・closing 過長を `deck-diagnostics` の受け皿で
>   回収。(5) 生成プロンプト `deckPlanSystemPrompt` の底上げ（現状は温存）。

> **テーマ2「HTML 出力」（大マイルストーン）**：
>
> - 磨き込んだ **Web preview（`SlidePreview` の CSS 忠実描画）をスタンダロン HTML プレゼンとして出力**。PowerPoint 離れ・HTML プレゼンの潮流に対応。
> - 自己完結（インライン CSS/JS・スライド送りナビゲーション）。図/表/コード/プレースホルダ描画を HTML に写像（既存の共有描画モデルを HTML レンダラに）。PPTX 出力と併存。
> - サイズ L〜XL。詳細設計は着手時に `docs/design/`（ADR 級）。

> **完了除去**（履歴は ADR ＋ git）：
>
> - 旧「凝ったレイアウトの到達性」→ **完了**（2026-07-03）。`07_コード／ログ`・`04_図＋説明`・`01_章扉`
>   ＋カード/プロセス/KPI の styled 箱到達を **1:1 非破壊の別系統グループ経路**で実装（`slide.groupKind` で分岐、
>   `group-layout.ts` `detectGroups`（幾何検出）→ `group-binding.ts` `expandGroups`（`bindContentByRole` 非経由）
>   → エディタはグループ単位フィールド、chrome 番号は編集可能スライド content・画像枠は継承。S1–S6 test-first、
>   [design/grouped-layout-binding.md](design/grouped-layout-binding.md)、field-map-bijection 全緑＝ADR-0011 の 1:1 維持）。
>   compare（課題と対策）は pin 専用（将来 `<!-- compare -->` で自動化余地）。
> - 旧「テンプレ差し替えの堅牢性を検証」→ #41 で完了（`autoSelectLayout` の role ベース縮退で
>   任意マスターに追従、`tests/template-swap.test.ts` が回帰を担保）。
> - 旧「アプリ内蔵 AI のアーキ設計」→ llamafile 同梱ランタイムで P1〜P6 実装済み（env-free 配布、
>   開発メモリ `llamafile_runtime_design`；mac 署名 P6 は初回リリース時に実機検証）。
> - 旧「UI / ボタン再編」→ ボタン重複整理（セルフレビュー F1–F6・シミュレート削除）＋
>   プレビュー自動追従（既存・リアクティブ）で完了（開発メモリ `ui_reorg`）。F5「Load Template 配置」
>   のみバックログ「テーマ切り替え / テンプレ管理」へ移送。

---

## バックログ（将来）

| 項目 | 内容 | サイズ |
|------|------|-------|
| 自動アップデート | Tauri Updater 経由（GitHub Releases） | M |
| アプリアイコン正式デザイン | 仮アイコン（青背景 "S"）を正式版へ差し替え | S |
| 画像・チャートの Markdown 埋め込み | `![alt](path)` / ```` ```chart ```` ブロック対応 | L |
| テーマ切り替え / テンプレ管理 | 複数テンプレ PPTX の管理・切り替え。**あわせて UI 整理**：現在トップバー常設の「Load Template」は低頻度＆協働ロック時に消える不整合があるため、この機会にファイルメニュー等へ集約する（UI 再編セルフレビュー F5） | M |
| ユーザ利用ガイド | 図 14 種・二段階編集・テンプレ流し込みを網羅したオンボーディング | M |
| 図編集 diff の見た目 | AI 図編集（diagram-edit）の変更プレビューが「フル Markdown vs 生 YAML」比較で見た目がズレる。図編集時は YAML 同士で diff（採用の動作は 6d036d1 で修正済・これは cosmetic） | S |
| フィールドクリアで空 ph が残る | 欄をクリアすると空パラグラフの placeholder がモデルに残る（1:1 には無害・export cleanliness の観点で将来検討） | S |
| serializer: 単独 content スライドが空出力 | index 0 の content スライドが autoSelect で Title 扱いになり、title(idx15) を idx0 として読むため空シリアライズ。`currentSlideMd` は解決済レイアウトをピンして回避済だが `serializeMd` 直呼びで露出 | S |

---

## 保留中の依存・運用

- **#34** — ブロッカー解消待ち。
- **#13 / js-yaml5** — 依存更新待ち（YAML パーサ）。
- **#2〜#4 / GitHub Actions** — **CI 再有効化後**に再着手（請求枠リセット 2026-07-01 → 3-OS マトリクスは release-only へ軽量化、開発メモリ ci_actions_billing）。
- **実験用一時ファイルの後始末** — テンプレ検証・headless 生成で散らかった temp 出力を整理。
