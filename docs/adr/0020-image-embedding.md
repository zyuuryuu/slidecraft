# ADR-0020: 画像埋め込みは data URI 埋め込み（Markdown `![alt](src)` → SlideIR image ブロック）

- **Status**: Accepted
- **Date**: 2026-07-06
- **関連**: [ADR-0011](0011-placeholder-input-bijection.md)（プレースホルダ束縛）／[[product_form_desktop]]（Tauri desktop）／[[dnd_pointer_not_html5]]（DnD 方針）

## Context

図/表/コード/mermaid は SlideIR の body ブロックとして実装済だが、**任意の画像**（スクショ・ロゴ・図版）を貼る手段が無かった。ユーザ要望：「ドラッグ&ドロップや貼り付けで画像を置きたい」。画像の**保存形式**が最大の設計論点：

- **(A) パス参照** `![](path/to.png)`：デッキは軽いが**ポータブルでない**（ファイルが動く/共有すると壊れる）。browser ではローカルパス不可、Tauri fs スコープの都度解決が必要、PPTX 出力時も解決が要る。
- **(B) data URI 埋め込み** `![](data:image/png;base64,…)`：デッキに画像が**自己完結**。`.slidecraft` 共有・PPTX 埋め込みが壊れない。デッキサイズは増える（base64）。

## Decision

**画像は data URI 埋め込みの SlideIR `image` ブロック**（`{ src, alt, placeholderIdx }`）とする。src は base64 data URI を既定（パス src もパーサは受けるが PPTX 埋め込み対象外）。

- **表現**：Markdown の行単独 `![alt](src)` を `image` ブロックに（body 領域1）。他の body ブロック（table/code）と同格・往復ロスレス。図/表/code/mermaid とは排他（1 body 領域に1図）。
- **描画**：`SlideCard` が body 枠に `<img object-fit:contain>`。**HTML 出力は SSR で SlideCard を再利用**するので自動対応（WYSIWYG）。
- **PPTX**：data URI をデコード → `ppt/media/image{N}.{ext}` に格納 → `<p:pic r:embed>` で body 枠に配置（mermaid→PNG の既存機構を一般化）。Content-Type Default は最終CT再構築で注入（inline 書き込みは再構築に上書きされる—副次で mermaid PNG の潜在バグも修正）。
- **挿入 UX**：**ペースト**（`paste` イベントの画像 clipboard → data URI）＋**ファイル D&D**（Desktop=Tauri `onDragDropEvent`＋fs read／Browser=HTML5 `drop`）。**native HTML5 file-drop は Tauri webview で不安定**なため desktop は Tauri のネイティブ file-drop を使う（[[dnd_pointer_not_html5]] と同根）。挿入は `handleInsertImage`＝現在スライドの body 図に設定（`layout:"auto"` で body 無しレイアウトも body 有りに再解決・他図は置換・undoable）。
- **レイアウト**：`autoSelectLayout` の `visualIdx` に image を追加＝画像のみでも body レイアウトへ（タイトル誤ルートしない）。

## Consequences

- デッキが**自己完結**＝共有/エクスポートで画像が壊れない（北極星の「配布物として成立」）。代償はデッキサイズ増（将来 media 分離＝`.slidecraft` 内 media フォルダ化の余地）。
- 図系ブロックと同じ束縛/描画/エクスポート経路を再利用＝WYSIWYG（プレビュー＝HTML＝PPTX）。
- パス src は非埋め込み（PPTX に出ない）＝将来パス→data URI 化 or fs 解決を足す余地。
- SVG data URI は ext/mime を持つが PowerPoint の SVG 対応は限定的（fallback PNG 未実装）＝当面 png/jpg/gif/webp 前提。

## References

- コード：`slide-schema.ts`（ImageBlock）・`md-slide-parser.ts`/`md-serializer.ts`（往復）・`SlidePreview.tsx`（`<img>`）・`placeholder-filler.ts`（`dataUriToImage`/`<p:pic>`/media/CT）・`template-loader.ts`（visualIdx）・`useDeckController.ts`（handleInsertImage）・`App.tsx`（paste＋file-drop）
- テスト：`tests/md-parser.test.ts`（往復）・`tests/image-block.test.ts`（PPTX 埋め込み）・`tests/template-loader.test.ts`（ルーティング）・`tests/e2e/app.spec.ts`（paste／drop 実描画）
- コミット：`0e98877`（pipeline）・`18d0059`（paste）・`806301b`（PPTX）・`94b7097`（file-drop）
