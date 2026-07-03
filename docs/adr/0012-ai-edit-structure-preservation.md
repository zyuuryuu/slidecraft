# ADR-0012: AI 編集の構造保全ハーネス（reconcile+validate を全適用経路に・正準規約は単一の源）

- **Status**: Accepted
- **Date**: 2026-07-03

## Context

AI にスライドを編集させると、指示していないのに**構造の足場を落とす**事象があった：先頭の
`<!-- slide: LayoutName -->` ヘッダー、`# タイトル`、`Category:/Date:/Footer:` メタ、
`<!-- card/step/kpi -->` セパレータ、`` ```diagram/```mermaid/```コード `` フェンス、GFM 表を、
~3B の小型モデル（時に frontier モデルも）が echo し忘れる。

適用は 3 経路すべて `parseMd(edited).slides[0]` で SlideIR を**丸ごと置換**するため、落ちた足場は
**決定論的に消える**：
- **前景 `handleApplySlide`**（「このスライドだけ適用」＝最頻経路）は diagram/mermaid しか old から
  引き継がず、layout pin・title・meta・groupKind が落ちたら消滅（適用後 `autoSelectLayout` が別
  レイアウトを選び直し、`#` の写像先が title(idx0)⇄content(idx15) で変わりタイトルが移動/消失）。
- **`batchEditDeck`**（複数選択一括）は**完全に無ガード**＝枚数×無検査で最も危険（無警告の部分破壊）。
- **`refineDeck`（condense）**は `validateCondense` ガードを通すが、同関数は **parse/言語/数値**のみ検査
  し**構造を一切見ない**ため、構造を落とした condense が「検証済み」として通る。

加えて副次バグ：`md-serializer` は単体 body 分岐でしか code/表を出力せず、`isTitleLayout(layout)` だけで
title/content 名前空間を選ぶため、**Title/sep レイアウトに pin された図/表/コード**や
**`auto` レイアウト＋メタ持ちの表紙**が serialize↔parse で**silent 消失**していた。

根の問題は「プロンプト不足」ではなく「**適用パスに決定論ガードが無い**」こと（[ADR-0005](0005-harness-over-model.md)
の harness-over-model がまさに指す領域）。さらに、正準プレースホルダ規約（title=0/15・subtitle=1/16・
meta=10/11/12・`Title.`/`Closing.` 命名）が **parser / serializer / AI ガードに複製**されており、片方だけ
直すと**サイレントにズレる**ドリフト源になっていた（実際に「reconcile は layout 名だけで title 名前空間を
判定、parser は meta フィールドでも title 昇格」という 1 点の不一致が潜在バグだった）。

## Decision

AI 編集の構造保全を**プロンプトの脆い期待でなく、決定論ハーネスで根絶**する（[ADR-0005](0005-harness-over-model.md)、
手本は `validateCondense`）。設計判断 A2/B1/D1、プロンプトは C3。

- **`reconcileEdit(old, edited)`（engine 純粋・[ADR-0011](0011-placeholder-input-bijection.md) 非破壊）**：
  AI が落とした構造を old から復元する。**respect-if-present（D1）**＝明示的に present（非空）なフィールドは
  尊重し、欠落/空のみ復元。layout の `auto` は「ヘッダー echo 忘れ」の強シグナルとして扱い、`auto` の時だけ
  old.layout を復元（明示 re-pin は編集の構造意図として尊重）。title/subtitle/meta は**復元後 layout の
  名前空間**で idx 解釈し、placeholders は **idx キーの Map マージ**で復元＝同一 idx を二重生成しない
  （**buildFieldMap の全単射を保存**）。図/表/コード・groupKind も `edited.X ?? old.X` で carry。全空の編集は
  失敗編集とみなし old を丸ごと維持。**削除は復元されるため、削除は本文編集経路でなく専用パスに寄せる前提**。

- **`validateStructure(before, after, kind)` ＋ `mergeVerdicts`（engine 純粋）**：構造欠落を HARD/SOFT で返し
  `validateCondense` と合流して retry を駆動。**strictness は kind で切替**：`condense` は意図的構造変更が
  無い前提で全欠落 HARD、自由な `edit` は layout pin loss のみ HARD（title/group は SOFT、図欠落は「carry が
  正常」なので edit では非検出）。

- **3 経路に配線（B1）**：
  - 前景 `handleApplySlide` は同期 UI ゆえ retry を持たず、**reconcile で復元＋復元内容を告知**（silent 禁止）。
  - `refineDeck`（condense）は `mergeVerdicts(validateCondense, validateStructure('condense'))` で HARD→retry、
    枯渇時は原文維持、clean 時に reconcile。
  - `batchEditDeck` は**自由指示**（「英語にして」等で事実/言語を変え得る）ゆえ **fact/language で棄却せず、
    構造 reconcile のみ**。

- **プロンプトは retry 削減の補助（C3）**：`slideMarkdownEditPrompt` に「保持する不変条件」ブロック
  （ヘッダー逐語 echo・title/meta/フェンス保持・数値/固有名詞 verbatim・言語保持）＋ A/B 決定木（迷ったら A）
  ＋ヘッダー保全 few-shot、condense も強化。**最終保証は決定論ゲート側**（プロンプトを過信して reconcile を
  弱めない）。死にコード `slidePlanSystemPrompt`/`systemPromptFor` を削除し 1 枚編集経路を Markdown 一本化。

- **正準規約は単一の源 `slide-roles.ts`**：`isTitleLayout` と title/subtitle/meta の idx 規約、そして
  **「title 名前空間＝`isTitleLayout(layout)` OR メタ持ち」**という parser と同一の判定を 1 箇所に集約し、
  parser・serializer・reconcile・validate が全部そこから導出する。これにより複製ドリフトを根絶し、
  上記の名前空間不一致を **reconcile と serializer の両側で同時に修正**（`auto`＋メタの表紙が往復・復元で
  正しく idx0 に載る）。`tests/slide-roles.test.ts` が **parser↔reconcile の title idx 一致**を固定する
  アンチドリフト回帰。

## Consequences

**良い点**
- AI がどう出力を崩しても、**最終的なスライド構造は決定論ハーネスが必ず守る**。名指し観点「構造ヘッダー
  保全」を前景・batch・refine の全経路で根絶。
- [ADR-0011](0011-placeholder-input-bijection.md) の 1:1 全単射は無傷（idx Map マージ／`field-map-bijection` 全緑）。
- 正準規約が**単一の源**になり、「フォーマットを変えても 1 箇所直せば全経路が追従」。テンプレ（マスター）を
  大きく変えても、ハーネスは**正準 SlideIR 層**だけを触り、テンプレ実 idx は下流の役割バインドが担うので
  非破壊（[ADR-0011](0011-placeholder-input-bijection.md) の 2 名前空間設計に同乗）。
- serializer round-trip の silent 消失（Title/sep pin の図/表/コード、auto＋メタ表紙）を解消し、AI に渡す
  Markdown が lossless になった。

**代償・限界**
- **削除は専用パス前提**：respect-if-present ゆえ「タイトル/図を消して」を本文編集経路で行うと reconcile が
  復元する。削除は削除操作に寄せる必要がある。
- **プロンプトは確率的**：~3B が不変条件を守り切れない残存確率は常にあり、保証は決定論ゲート側という位置づけ。
- **数値/言語の決定論ガードは refine 経路のみ**：前景/batch では数値改変・言語ドリフトをプロンプトで抑止する
  のみで決定論的には止めない（batch は自由編集ゆえ棄却しない方針）。前景に SOFT 数値警告を足す余地は残課題。
- `slideSystemPrompt`（LlmAssist の手動コピー用・Markdown 出力）のレイアウト名ハードコード、diagram/
  diagram-edit プロンプトの純度・id 保全、空 section/closing の生成品質（`deck-diagnostics` 受け皿）は本 ADR
  のスコープ外の残課題（[ROADMAP](../ROADMAP.md) テーマ 1 に残置）。

## References

- [ADR-0005](0005-harness-over-model.md) — harness-over-model（本 ADR はその AI 編集への適用）
- [ADR-0011](0011-placeholder-input-bijection.md) — プレースホルダ⇄入力 全単射（reconcile が保存する不変条件）
- [ADR-0002](0002-primary-surface-deck.md) — deck=唯一の源・Markdown は入出力（往復の前提）
- 実装：`src/engine/{slide-roles,ai-reconcile,ai-validate,refine,md-serializer,md-slide-parser,deck-plan-prompts}.ts`、
  `src/components/useDeckController.ts`。テスト：`tests/{ai-reconcile,refine-structure,prompt-invariants,slide-roles,md-serializer}.test.ts`。
