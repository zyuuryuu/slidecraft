# ADR-0004: OOXML スタイル階層＝lstStyle は差分のみ

- **Status**: Accepted
- **Date**: 2026-04（v2 S0〜S3 完了時。問題の発端は 2026-03-31 の S0 スパイク）

## Context
PowerPoint のテキストスタイル継承は **slideMaster → slideLayout → slide** の三層で解決される。2026-03-31 の S0 スパイクで、テンプレート生成スクリプト `create_30_layouts.py` の `xml_ph()` が、レイアウトの `lstStyle` 内の全レベル（`defPPr` + `lvl1pPr`〜`lvl9pPr`）にフォント名・サイズ・色をハードコードしていた。その結果、PowerPoint のスライドマスター UI からフォントサイズ等を変更しても**スライドへ反映されない**（レイアウトのハードコードが master を完全に上書きしてしまう）。テンプレート尊重・マスター編集可能性は本製品の前提であり、この継承破壊は許容できない。

## Decision
OOXML の各層に責務を分離し、各層は「上位との差分」のみを持つ:

- **Theme**: フォントファミリを定義（例 `majorFont=Georgia`, `minorFont=Calibri`）。
- **Master**: `titleStyle`/`bodyStyle` でテーマフォントを**参照**する（`+mj-lt`/`+mn-lt`）。実フォント名はここに書かない。
- **Layout `lstStyle`**: master との**差分のみ**（サイズ・色など）をオーバーライド。フォント名・サイズ・色を全レベルに敷き詰めない。
- **Slide**: テキスト内容のみ。スタイル情報は持たない。

流し込みは `placeholder-filler.ts` が `<p:ph idx="N">` シェイプの `<a:t>` テキストノードのみ差し替え、`lstStyle`/`spPr` は layout からそのまま保持する。`<a:rPr>` を付与するのは Markdown の `**太字**`/`*斜体*` 等インライン装飾が必要な箇所に限定する（`md-to-ooxml.ts`）。font 解決は `template-loader.ts` が layout lstStyle → rPr → master の順でフォールバックする（継承チェーンを尊重した読み取り）。

## Consequences
- 利点: テンプレートのスライドマスター UI 編集（フォント・サイズ・色の一括変更）が機能し続ける。会社テンプレートの design intent を壊さず流し込める。
- 利点: 流し込みは text-only 差し替えに収束し、placeholder のスタイル継承破壊リスク（設計書 R2）を最小化。
- トレードオフ: レイアウト固有の見た目を変えたい場合も「差分だけを最小オーバーライド」する規律が要る。色の完全復元は別途精査（ROADMAP「テンプレートの色完全復元」, サイズ M）。
- **DO-NOT-UNDO ガードレール**:
  - レイアウト `lstStyle` の `defRPr` にフォント名・サイズ・色を**全レベルでハードコードしない**。
  - 流し込み時に `lstStyle`/`defRPr` を保持し、`<a:t>` のみ差し替える。`<a:rPr>` 付与は装飾が要る箇所のみ。
  - テンプレート生成・改修後は、PowerPoint でスライドマスター編集が反映されるか必ず検証する（LibreOffice / Google Slides でも確認推奨）。

## References
- `docs/design/MarkdownToPptx_Design.md` — §5.1 スライド生成フロー / §5.2 テキスト差し替え方針 / §6 リスク R2
- `docs/ROADMAP.md` — v2「OOXML スタイル階層の正しい設計」と教訓
- `src/engine/placeholder-filler.ts` — `lstStyle`/`spPr` 保持・text-only 差し替え
- `src/engine/md-to-ooxml.ts` — インライン装飾のみ `<a:rPr>` 付与
- `src/engine/template-loader.ts` — layout lstStyle → rPr → master フォントフォールバック
- 開発メモリ: `feedback_lstyle_hardcode`（lstStyle hardcode prohibition）
