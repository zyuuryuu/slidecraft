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

## 追記（2026-07-06）: 画像は PICTURE 枠を優先（B）

画像バインドを **picture 専用プレースホルダ対応**に拡張。レイアウトが `type="pic"`（`placeholderRole`→"picture"）の枠を持つとき、画像はその枠に優先バインド（Nth を同じ 1-based ordinal で・過大 ordinal は picture にクランプ）。無ければ従来どおり Nth body へフォールバック。preview / form / PPTX は共有 `imagePlaceholder()`（`placeholder-binding`）を通すので分岐しない＝WYSIWYG 不変。

- **定義は STRICT**（`type="pic"` のみ）。`obj` は含めない — obj は多目的スロット（SmartArt / 表 / 図 / テキスト）で、画像を強制すると設計意図のコンテンツを押しのけ、`usableBody` の picture-body 回避コストモデルと矛盾する。
- **レイアウト選択は不変**（`autoSelectLayout` を picture 枠優先にはしない）— 別リスク面のため保留。resolver は「既にある画像がどの枠に乗るか」だけを決める。
- 束ねる canonical/報告書テンプレは `type="pic"` ゼロ → **全て no-op（byte-identical）**。B が効くのは pic 枠を持つ**インポート master**（velis「Two Columns, Picture Right」等）。テストは実 fixture（velis）で pic バインド＋`<p:pic>` の EMU 幾何一致を検証。
- コード: `placeholder-binding.imagePlaceholder` ＋ `placeholder-filler`・`SlidePreview`・`SlideEditor`（3箇所を同 resolver に統一）。テスト: `tests/image-placeholder.test.ts`。

## 追記（2026-07-06）: 画像のサイズ・位置微調整（案B）

画像は既定で「枠いっぱい」だった。ユーザ要望で**手動ジオメトリ上書き**を追加＝枠任せから正確な位置・サイズへ。

- **schema（R4・ユーザが選択で承認）**：`ImageBlock` に `rect{x,y,w,h}`(inch)・`fit`("contain"|"cover")・`aspect`(内在 w/h) を optional 追加。無指定は従来どおり枠バインド。
- **共有解決**：`imageRect(image,ph)=rect ?? 枠box`、`imageAspectRatio(image,box)`（**プレビュー drag と フォームが同一比でロックする単一の真実**＝両者が別々に fallback を書いて食い違った不具合の根治）、`fitImageInBox` が contain=レターボックス / cover=`<a:srcRect>` クロップ を PPTX 側でも算出しブラウザ `object-fit` と一致（WYSIWYG on resize）。EMU=round(inch×914400)。
- **Markdown**：`![alt](src){x=,y=,w=,h=,fit=,ar=}` サフィックスでロスレス往復（属性無しは素の記法・非汚染）。
- **UX**：フォーム＝X/Y/W/H 数値＋縦横比固定＋contain/cover＋枠にリセット（W/H は正・X/Y は非負にクランプ）。プレビュー＝**pointer** でドラッグ移動＋角ハンドルのリサイズ（native DnD 不可・[[dnd_pointer_not_html5]]／ドラッグ中は local rect、pointerup で1コミット＝undo 1件）。挿入時に `naturalWidth/Height` で `aspect` を実測。
- **レイアウト選択（保留分の同梱）**：画像スライドは `pickLayout`/`suggestLayouts` の `hasImage` で **pic 枠を持つレイアウトを自動優先**（text の picture-body 回避は不変＝回帰なし）。
- コード：`placeholder-binding`（imageRect/imageAspectRatio/fitImageInBox/dragImageRect）・`placeholder-filler`（<p:pic> rect+srcRect）・`SlidePreview`（drag/resize）・`SlideEditor`（数値フォーム）・`template-catalog`/`template-loader`（hasImage）・`useDeckController`/`App`（挿入+実測+commit）。テスト：`image-geometry.test.ts`・`image-placeholder.test.ts`・e2e `image: dragging …`。多エージェント敵対レビューで確定した 2 実バグ（フォームのゼロ/負・aspect fallback の preview/form 乖離）を修正。

## 追記（2026-07-06）: 最背面レイヤー（既存を壊さない挿入）

画像挿入が本文プレースホルダを**置換**して既存内容を壊す問題。ユーザ要望で**最背面レイヤー**モードを追加。

- **schema（R4・ユーザ選択で承認）**：`ImageBlock` に `behind?:boolean`。true＝プレースホルダを占めない backmost レイヤー（スライド背景 `<p:bg>` ではなく `<p:pic>`）。既定は全面（`SLIDE_IN`）、案B の rect/fit/aspect と併用可。
- **挿入の既定**：`handleInsertImage` は対象スライドに**可視テキスト or 図があれば behind**（既存を保持＝図も消さない・layout 据置）、**空なら従来の本文図**（layout auto・他図置換）。フォームの「▤最背面⇄本文枠」トグルでいつでも切替。
- **z-order**：PPTX は behind の `<p:pic>` を spTree の**先頭**に emit（＝最背面）、`imageBodyIdx` は undefined でプレースホルダ非スキップ。プレビューも placeholder map の**前**に描画。mermaid PNG と共存できるよう rId 共有をやめ `buildSlideRels({rId,target}[])` 化（behind＋mermaid＝rId2/rId3）。
- **編集**：behind の全面画像はハンドルが content 下に隠れるため preview ドラッグ非対応＝**フォームの数値（X/Y/W/H）**で調整。本文図はドラッグ/リサイズ（段階2）継続。
- **Markdown**：`{behind=1}` サフィックスで往復。behind 画像は本文/図を占めず別行で emit（`imageLine`）、grouped（card/step/kpi）スライドでも `matchImageLine` で section 分割前に抽出（最終カラムに吸収されない — 敵対レビューで発見・修正）。
- コード：`slide-schema`（behind）・`md-slide-parser`（parse/grouped 抽出）・`md-serializer`（別行 emit）・`placeholder-binding`（imageRect/SLIDE_IN）・`placeholder-filler`（z-order/rId）・`SlidePreview`（backmost 描画）・`SlideEditor`（トグル）・`useDeckController`（挿入判定）。テスト：`tests/image-behind.test.ts`（往復/共存/z-order/全面）・e2e（非破壊 drop）。16エージェント敵対レビューで確定 3件（grouped return 欠落＝往復消失〔独立発見・修正〕／型注釈／table-in-column は既存制約で範囲外）を反映。

## References

- コード：`slide-schema.ts`（ImageBlock）・`md-slide-parser.ts`/`md-serializer.ts`（往復）・`SlidePreview.tsx`（`<img>`）・`placeholder-filler.ts`（`dataUriToImage`/`<p:pic>`/media/CT）・`template-loader.ts`（visualIdx）・`useDeckController.ts`（handleInsertImage）・`App.tsx`（paste＋file-drop）
- テスト：`tests/md-parser.test.ts`（往復）・`tests/image-block.test.ts`（PPTX 埋め込み）・`tests/template-loader.test.ts`（ルーティング）・`tests/e2e/app.spec.ts`（paste／drop 実描画）
- コミット：`0e98877`（pipeline）・`18d0059`（paste）・`806301b`（PPTX）・`94b7097`（file-drop）
