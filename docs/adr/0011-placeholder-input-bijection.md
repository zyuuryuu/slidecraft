# ADR-0011: プレースホルダ⇄入力＝検証済み全単射（役割バインドはレンダー1境界に封じる）

- **Status**: Accepted
- **Date**: 2026-07-02

## Context
SlideCraft には 2 つの idx 名前空間が併存する:

- **content（SlideIR）＝正準 idx**：Markdown パーサ／プランが出力（title=15/0, subtitle=1/16, body/column=1..9, category=10, date=11, footer=12, slideNumber=50）。テンプレを知らない意味モデル。
- **layout placeholder ＝テンプレの実 idx**：会社テンプレごとに任意（例: 官公庁 cover は dt@10 / ftr@11 / sldNum@12、body-typed の 資料番号@13・メタ情報@14; velis は date@14 / footer@15 / sldNum@16; Midnight は body@10/11/12）。

両者はレンダー時に `bindContentByRole` が **役割**で写像する。これはプレビュー・エクスポート・Markdown 往復では正しく動く（[ADR-0002](0002-primary-surface-deck.md) 準拠、共有バインドで [ADR-0003](0003-diagram-pipeline.md) と同じ WYSIWYG）。

問題は **エディタ**だった。エディタは「テンプレ実 idx」でフィールドを出し入れするのに、書き戻しは正準 idx→役割 で**再解釈**されるため、両者が非単射に橋渡しされ、実バグを生んだ:
- メタ枠の**ドロップ／別枠化け**（日付欄に打つと消える／フッタ欄がに日付枠へ）、
- body-typed のカスタム枠（資料番号）が**未反映**、
- メタ情報に打つと**サブタイトルを上書き**（idx-1 二重性）、
- 複数カラムの**疎入力 bleed ＋データ損失**（2カラム目だけ入力→1カラム目へ、後から1を入れると2が消える）。

敵対検証ワークフロー（エージェントが実 vitest probe を書いて走らせ、~1000 合成レイアウト・~500 編集手数をファズ）で **9 件の実バグ**を確認。うち1件は実同梱テンプレ。**全充填のみの不変条件テストはこれらを全て見逃していた**（順序バインドは全カラムが埋まった時だけ正しいため）。

## Decision
プレースホルダ⇄入力の 1:1 を**個別ケースの逆写像ヒューリスティックでなく、構造として保証**する。

- **`buildFieldMap`（検証済み全単射）**：レイアウトの編集可能プレースホルダ ⇄ content idx の対応表を、各割当てを**マーカー probe で `bindContentByRole` をシミュレート**して「自分の枠に往復し、他を乱さない」ことを実証しながら確定する。往復しない／衝突する候補は採らず、どうしても不可なプレースホルダは**フィールドから除外**する（安全縮退＝破損させない）。返るマップは常に真の全単射（部分的でも健全）。
- **`bindContentByRole` の 2 パス化**：Pass-1 は「同一 idx の placeholder があり、役割が一致（または content の役割が非意味的な "other"）」の時だけ **idx-exact 直バインド**。これで**繰り返し役割（body/columns）が位置安定**にバインドされ（content"2"→2番目の body 枠、疎入力でも正しい）、alien マスターでは役割不一致で発火せず**非回帰**。Pass-2 は残りを役割でバインド。
- **`hasCtrTitle` はレイアウト由来**（ctrTitle 枠の有無）に固定。idx-0 内容の有無で判定しないので、編集中に idx-1 の subtitle/body の意味が反転しない（表紙タイトルを消しても subtitle が流れない）。
- **エディタ**は各フィールドが**自分の contentIdx を直接 read/write**（毎キーストロークの逆推論を廃止）。slideNumber 役割は編集欄から非表示。図/表の占有枠は **`nthBody` 解決**（`placeholderIdx` は 1 始まりの body 序数であって生 idx ではない）でスキップ。
- レンダー時の役割バインドはそのまま（正準 content を保持）＝レイアウト切替・alien・Markdown 往復に強い。役割推論は**このレンダー1境界に封じ込め**、編集・プレビュー・エクスポートは同一 `bindContentByRole` を共有して乖離しない。

## Consequences
- 利点: **任意テンプレ**で、打った文字が正しい枠に出る（bleed/drop/上書きなし）。編集列・レイアウト切替に対して安定。alien マスター非回帰。
- 利点: 1:1 は **全同梱テンプレ×全レイアウトの不変条件テスト（full＋sparse）**で恒常保証。将来テンプレが 1:1 を破れば CI が落ちる。
- 利点: Placeholder は維持される（[ADR-0002](0002-primary-surface-deck.md)/PowerPoint モデル）—空枠は出力に描画されず、埋めれば自枠に出る。
- トレードオフ: 真に束縛不能なプレースホルダ（同一単一正準 idx を争う重複メタ役割、あるいは title 系 idx に置かれた body）は**アプリ内編集から除外**される（エクスポートでは継承表示のまま）。稀な authoring。
- 既知の別件（1:1 には無害）: フィールドをクリアすると空のプレースホルダ項目がモデルに残る。エクスポートの綺麗さは別課題。
- **DO-NOT-UNDO ガードレール**:
  - `buildFieldMap` は probe 自己検証を通ったフィールドのみ emit する。衝突/ドロップする contentIdx を**強制割当てしない**（`pick===undefined` は `continue`＝除外）。
  - `hasCtrTitle` は**レイアウト由来**を維持（idx-0 内容で判定しない）。
  - 不変条件テストは**必ず sparse／部分充填**を含める（全充填のみは順序バインドのバグを隠す）。
  - エディタは図/表の占有枠を **`nthBody` 解決**でスキップする（生 idx == 序数 の比較にしない）。

## References
- `src/engine/placeholder-binding.ts` — `bindContentByRole`（2 パス）/ `contentIdxForPlaceholder`（役割逆写像）/ `buildFieldMap`（検証済み全単射）/ `layoutHasCtrTitle`
- `src/components/SlideEditor.tsx` — `buildFieldMap` 駆動フィールド・`nthBody` スキップ
- `tests/field-map-bijection.test.ts` — 全テンプレ×全レイアウト不変条件（full＋sparse）＋編集列安定性＋病的合成レイアウト
- `tests/editor-field-routing.test.ts` / `tests/placeholder-binding-direct.test.ts` — メタ配線・カスタム枠・図表スキップ
- 関連 ADR: [0002](0002-primary-surface-deck.md)（deck=源）/ [0003](0003-diagram-pipeline.md)（共有 painter WYSIWYG）/ [0004](0004-ooxml-style-hierarchy.md)（スタイル継承）
- 開発メモリ: `feedback_test_partial_states`（部分・編集状態を突く／敵対プローブ）
