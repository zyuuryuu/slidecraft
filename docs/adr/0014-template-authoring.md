# ADR-0014: テンプレ作成補助 — 修復オファー・ゼロから生成・永続化

- **Status**: Accepted
- **Date**: 2026-07-04

## Context

ROADMAP テーマ2「テンプレ作成補助 — 新テンプレの作成/登録支援」（サイズ L）。着手前の実態は
「読む側」だけが堅牢（`loadTemplate` → `buildCatalog` → 受け入れゲート `assessTemplateHealth`、
alien 対応・回復ラダー・テスト群完備）で、**書く側はゼロ**：rejected テンプレは門前払い、マスターの
生成/書き出しは開発 CLI `scripts/rebuild-template.ts` のみ、レジストリはセッション内 in-memory
（Slice 1a）だった。詳細設計＝[docs/design/template-authoring.md](../design/template-authoring.md)。

## Decision

ユーザ合意（2026-07-04）した3点を骨格に、6スライスで実装した：

1. **スコープ＝登録支援＋新規生成＋永続化**、**着手は登録支援から**。
2. **登録支援は「拒否」から「修復提案」へ**（`src/engine/template-repair.ts`）：ゲートが block する
   NO_TITLE_ROLE / NO_BODY_ROLE を、回復ラダーで救えなかった placeholder への **type 付与の最小
   XML パッチ**で解消。候補推定はフォントサイズ最大→title／面積最大→body の決定論ラダー、
   提案は日本語の理由つき。**過剰修復ゼロ**（block の無いマスターは無改変）が不変条件。
   取り込み UI は確認ダイアログで「整形して取り込む」— 適用に成功した bytes だけを登録する。
3. **生成はゼロから（フル OOXML）**（`src/engine/template-writer.ts`）：`TemplateSpec`（名前・
   セマンティック配色 9 スロット・フォント major/minor・レイアウト定義列）から
   `[Content_Types]`/rels/presentation/slideMaster/slideLayoutN/theme を全て書き出す。
   レイアウト定義は canonical 30 種を `template-layout-library.ts` に昇格（座標/idx/type は実証済み
   の値、色はパレットキー化、family=dark/light が背景とヘッダーバー装飾を決める）。
   **検証ゲート＝読む側の再利用**：`loadTemplate(write(spec))` → health ok・座標±1%・
   distill→`generatePptx` でコンテンツ生存。
4. **UI**（`TemplateCreator.tsx`）はマスターピッカー「＋ テンプレを作成…」から。生成→登録→適用で
   メインプレビューが即時反映＝ライブ確認（モーダル内プレビューは持たない）。
5. **AI はスペックの提案のみ**（`src/engine/template-spec-prompts.ts`、[ADR-0005](0005-harness-over-model.md)
   準拠）：自然言語→ TemplateSpec JSON を新 AiMode `template-spec` で取得し、検証・正規化・
   フォールバック・**コントラストガード**（titleText/background・bodyText/canvas の輝度比 <3 を
   決定論修正＋告知）はコード側が行う。PPTX を書くのは常に決定論コード。
6. **永続化**（`src/ipc/master-store.ts`＝Slice 1b）：デスクトップは app-local-data の
   `masters/index.json`＋`<id>.pptx` に保存し起動時ハイドレート。index は防御的パース。
   fs スコープは `$APPLOCALDATA/masters/**` に限定（capabilities）。ブラウザは従来どおり
   セッション内に縮退。

## Consequences

**良い点**
- 手持ち PPTX の「使えない」体験が「直して使う」体験になり、新規テンプレはアプリ内で作れる。
  レジストリ永続化により作成/取込したテンプレが再起動後も残る。
- 生成/修復物は既存の受け入れゲート・alien 系回帰テストがそのまま品質保証になる（読む側と書く側が
  同じ正典を共有）。
- AI 提案は小さなローカルモデルの雑な JSON でも常に使えるスペックに落ちる（ハーネス側で担保）。

**代償・限界**
- **PowerPoint 実機での開封確認は未実施**（開発環境に PowerPoint/動作する LibreOffice が無い）。
  自前ローダ round-trip＋PPTX 組み立て生存で担保しているが、実機確認は次マイルストーンの手動項目。
  【追記 2026-07-04】多レンズ構造検証（expat 整形式・python-pptx 開封・rels/Content-Types 整合）と
  実アプリ取り込みのユーザ確認まで完了（`tests/pptx-wellformed.test.ts` / `template-writer-conventions.test.ts`
  で恒久ゲート化・マスター ph 5種と docProps 等の慣習パートも生成に追加）。副産物として canonical の
  整形式破損を発見・根絶（`31c556e`）。残り＝PowerPoint 実機（web 版可）での開封のみ（ROADMAP バックログ）。
- ~~生成レイアウトの構成は内蔵 30 種固定（サブセット選択・カスタムレイアウト UI は将来）。
  モーダル内ライブプレビューも将来課題（現状は適用後のメインプレビューで確認する運用）。~~
  【追記 2026-07-07・作成後続UI 実装完了】`TemplateCreator` にモーダル内**ライブプレビュー**（`buildTemplatePreview`＝
  `writeTemplate→loadTemplate→distill` を debounce・`SlidePreview` 再利用＝WYSIWYG）／**レイアウトサブセット選択**
  （30 種チェックボックス→`spec.layouts`・空/不足は受け入れゲート `assessTemplateHealth` 再利用で never-silent 無効化）／
  **カスタムレイアウト定義**（`LayoutEditor.tsx`＝`LayoutDef` フォーム・showcase スライドで即プレビュー・名前は
  `combineLayouts` で非空/一意化・数値は有限値ガード）を追加。全て `spec.layouts` へのデータ渡しで完結し **schema.ts 不変
  （R4 非該当）**。敵対レビューで7件是正（custom-only 作成ブロック・NaN 座標・名前衝突/空・health staleness race）。
- 修復は type 付与のみ（ジオメトリ実体化・レイアウト命名の修復は扱わない）。
- `useAiGeneration.ts` は既存の 400 行超過に +9 行（モード追加）。分割は別途。

## References

- 設計書: [docs/design/template-authoring.md](../design/template-authoring.md)
- テスト: `tests/template-repair.test.ts` / `tests/apply-template-repair.test.ts` /
  `tests/template-writer.test.ts` / `tests/template-spec-prompts.test.ts` / `tests/master-store.test.ts`
- 関連 ADR: [ADR-0005](0005-harness-over-model.md)（ハーネス over モデル）、
  [ADR-0011](0011-placeholder-input-bijection.md)（1:1 バインディング）
