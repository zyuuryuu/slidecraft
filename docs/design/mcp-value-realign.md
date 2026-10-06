# MCP 再設計 — ユーザ価値起点のサーフェス整列（DISCUSS）

- Status: 💬 DISCUSS（議論のスナップショット。決定部分は [ADR-0037](../adr/0037-mcp-surface-realignment.md) に永続化済み・2026-10-06）
- Date: 2026-09-28（§7 の監査は 2026-10-06 追記・#466）
- 参加: ユーザ・レビュー統括セッション

## 1. ユーザ価値（北極星）

> 手元の AI に指示を出すと、シームレスに出来上がっていくスライドが**見える**。
> 文字面だけでは理解しにくい内容も、形になった瞬間にレビューできる。（ユーザ・2026-09-28）

分解すると 2 つの価値の合成：

1. **著作の委譲** — 人は markdown もツールも触らない。自然言語で指示するだけ。
2. **形成過程の可視化** — 完成品を最後に受け取るのではなく、途中が見える。スライドは成果物である
   前に**思考のレビュー媒体**（AI の理解が正しいかを、視覚化された形で瞬時に検証する）。

つまり製品の本体は「md→pptx 変換器」ではなく、**人間が見ている前で AI が形を作っていくライブな
ループ**である。ADR-0009/0033 の協働ホストモデルはこの北極星の実装だったと再確認する。

## 2. 用途の主従（確定）

| # | 用途 | 位置づけ |
| --- | --- | --- |
| U1 | **ライブ共著**：人が Tauri GUI を開き、隣の AI（Claude Code/Cursor）が MCP で編集。人は見て・指示する | **主（製品の核）**。ユーザ確認済み（2026-09-28・「当初のイメージは前者」） |
| U2 | **headless 著作**：GUI 不在の stdio 単独（Cursor 単体等）。成果物は export／`get_slide_image` で確認 | 従（U1 の劣化モード）。ただし入口として重要——実機フィードバック（#298/#332）はここから来た |
| U3 | **テンプレ工務の AI フル委譲**：`create_template`／TemplateSpec／（将来）マスター取り込み | **維持**。「AI にフルに任せる余地を作るために作った」（ユーザ・同日）。削減対象にしない |
| — | CI/バッチ生成（md→pptx 大量変換） | **未決**（非目標とも目標とも決めていない。決めるときに追記） |

## 3. 診断 — 「迷走」の実体

- ツール面は **18（ADR-0008・6月）→ 38（現在）** に 3 ヶ月で倍増。各追加は局所的に正当
  （ADR-0015 の構造操作・ADR-0034/35/36）だが、**用途レベルの設計単位が無いまま堆積**した。
  ADR-0033 は管制（control plane）を 1 つにしたが、**サーフェスの用途別再区分は未実施**。
- 説明文だけで約 3.8k 字（≈3–4k トークン）＋スキーマ＝**毎セッション 5–6k トークンの固定費**
  （2026-10-06 の実測では**過少**だった — 実際は約 6.9k–8.1k。§7 参照）。
  U1 では 1 指示あたりの往復・トークンが**人が画面の前で待つ体感レイテンシそのもの**なので、
  これは品質問題である。
- 「何が悪いか」を尋ねる口が 3 系統（`get_deck_issues`／`validate_deck`／`get_slide_fix_request`）、
  ガイドが 4 ツール、read がツール＋リソースの二重面——**個々に理由はある**（ADR-0008 の互換性フロア
  判断）が、初見の AI がループに入るまでの読解コストを積み上げている。
- 拡張面は 2 枚ある：**md-DSL は安い拡張面**（マーカー追加はツール面を増やさない。#396–#404 の
  語彙輸入はすべてこちら）、**ツール面は高い拡張面**（毎セッションの固定費に直結）。迷走の一因は
  この区別なしにツール面へ足したこと。今後の機能追加は**まず md-DSL 側で表現できないかを問う**。

## 4. 再編原理 — CRUD 分類ではなく「ループの温度」

U1 のループ：指示 →（AI: 契約参照→編集→自己診断）→ 人が見る → 次の指示。
（下表は 2026-09-28 のスケッチ。38 本全部の較正済み分類と実測トークンは **§7** が上書きする）

| 温度 | 段階 | 現状 | 方針 |
| --- | --- | --- | --- |
| コールド（セッション 1 回） | 調達・契約（テンプレ・書式・budget・図メニュー） | ガイド 4＋capabilities＋list_templates に分散＝往復とトークンの浪費 | **1 発の bootstrap に統合してよい**（太くても 1 回きり）。旧ツールは当面 alias 維持 |
| ホット（毎指示） | 著作（set/insert/delete/move/duplicate/set_slide_diagram）・レバー（split/convert）・診断（issues）・read（get_slide） | 概ね直交で健全（ADR-0015 の成果） | 最小・直交・低トークンを死守。**1 往復削減が体感に直結** |
| 出口（稀） | export_pptx / save_project / validate_deck | 健全 | 現状維持 |
| 人間側 | undo/redo・doc 切替・register_templates | AI ツール面に常時露出 | **削除しない**（ユーザ意思なし）。ただし**プロファイル別登録**で solo セッションには collab 専用ツールを見せない（`register_templates` の host 限定登録という**前例が既にある**） |

### 測る指標（再設計の合否判定）

1. **time-to-first-visual**：指示から最初の視覚変化までの時間
2. **1 指示あたりの往復数・トークン**（コールド分離後のホットループで）
3. 変化の増分性：deck 丸ごと再生成に落ちる操作をゼロに近づける（図の自動保持・構造操作は既にこの思想）

## 5. U1 を強くする対課題（MCP の外・GUI 側）

- **AI が今どこを変えたかへの追随**：変更スライドへの自動ジャンプ／ハイライト。「瞬間的にレビュー」の
  体感を直接決める。MCP 側は deckChanged fan-out 済みなので GUI の表示課題。
- U2→U1 への導線：stdio 単独で使い始めた人に GUI ライブビューの存在を伝える（solo 起動時の案内等）。

## 6. 進め方

1. この文書の合意（用途の主従・温度原理・指標）→ 決定部分を ADR 化（ADR-0008 の
   「読み取りツール削除禁止」等のガードレールは**用途プロファイル文脈で** supersede を判断）
2. 証拠集め：実セッションのツール呼び出し頻度・ガイド系の実効性（敵対的監査・ADR-0008 の再来を避ける）
3. bootstrap 統合とプロファイル別登録の設計 → Issue 分割（S/M 単位）
4. 段階実装：追加→alias→（証拠が揃ってから）縮退。**削除は最後・証拠つき**

## 7. 敵対的監査（2026-10-06・#466）— 分類の較正とトークン固定費の実測

ADR-0037 D4「削除は最後・証拠つき」の証拠集め第 1 弾。38 ツール全部を「このツールが無いと本当に
困るか」を問う側に立って監査した。§3–§4 のスナップショットとの乖離はこの節が上書きする
（ADR-0037 本文は immutable のためこちらに記録）。

### 7.1 測り方（再現手順つき）

- **測定対象**: solo stdio サーフェスの `tools/list` 応答そのもの。`buildServer(createSession(null))` を
  MCP SDK の `InMemoryTransport` で Client に繋ぎ `tools/list` を呼び、ツールごとに
  `{name, description, inputSchema}` を**改行なし JSON**（compact）に直列化した文字列を計測した。
  solo は `register_templates` を含む **38 本**（collab の AI クライアントは sharedOnly のため
  これが隠れて 37 本）。
- **トークンの概算法**: Claude のトークナイザは非公開で、この計測環境では `count_tokens` API も
  使えないため、公開トークナイザ **o200k_base**（OpenAI 系。npm `gpt-tokenizer`）での符号化長を
  表の値とした。Anthropic の公式ガイダンスでは tiktoken/o200k 系は Claude 比 **15–20% 過少**
  （非英語はそれ以上）なので、Claude 換算は **×1.15–1.35** のレンジで併記する。
- **測っていないもの**: クライアント側のツール提示フレーミング（1 ツールあたり数トークンの
  ラッパ）と resources（`deck://…`）側の列挙コスト。どちらも上乗せ方向なので、本表は**下限寄り**。

### 7.2 固定費の実測 — 「約 5–6k」は過少

| 範囲 | o200k 実測 | Claude 換算（×1.15–1.35） |
| --- | --- | --- |
| 38 ツール合計（description＋inputSchema＋name） | **5,972** | **約 6.9k–8.1k** |
| うち説明文のみ | 1,955（3,983 字） | 約 2.2k–2.6k |

- §3 の「説明文だけで約 3.8k 字」は**正確**（実測 3,983 字）。「毎セッション 5–6k トークン」は
  **過少**で、スキーマ込みの実態は約 6.9k–8.1k。診断としての方向（固定費が品質問題）はむしろ強まる。
- 温度別の内訳: **ホット 16 本で 3,503（59%）**・コールド 13 本で 1,478（25%）・出口 3 本で 482・
  人間側 6 本で 509。**コールド bootstrap 統合（v0.5.0 スコープ）だけでは固定費は最大 25% しか
  下がらない** — 統合の主眼は往復削減であって固定費削減ではない、と期待値を較正しておく。
  固定費を削るならホット側の説明文圧縮（特に下表上位 2 本: `set_slide_diagram` 408 ＋
  `apply_design_intent` 336 ＝全体の 12%。インラインの JSON 例が主因）が効く。

### 7.3 較正済み温度分類と md-DSL 重複判定（38 本全行）

「md-DSL 重複」＝その操作が `set_slide_markdown` 経由の Markdown 語彙（D3 の安い拡張面）でも
表現できるか。read/契約/出口/人間側は著作面ではないので対象外（n/a）。

**コールド（セッション 1 回・調達/契約/入口）— 13 本・1,478 tok**

| ツール | tok | md-DSL 重複 | 備考 |
| --- | --- | --- | --- |
| new_project | 204 | n/a | 入口。§4 の表では未分類だった（乖離①） |
| create_template | 168 | n/a | 入口（U3）。同上 |
| use_template | 154 | n/a | 入口。同上 |
| open_project | 141 | n/a | 入口。同上 |
| list_templates | 134 | n/a | §4 どおりコールド |
| get_authoring_guide | 134 | n/a | ガイド 4。bootstrap 統合対象（D2） |
| get_diagram_guide | 95 | n/a | 同上（図タイプ毎に 1 回） |
| get_template_capabilities | 95 | n/a | §4 どおりコールド |
| get_deck_markdown | 85 | n/a | 全 deck read ＝セッション初回の全体把握（乖離②） |
| get_project_info | 80 | n/a | 低頻度 read。削除候補（7.4） |
| get_deck | 79 | n/a | 全 deck read。同乖離② |
| get_diagram_types | 64 | n/a | ガイド 4 |
| get_template_spec_guide | 45 | n/a | ガイド 4 |

**ホット（毎指示・著作/レバー/診断/per-slide read）— 16 本・3,503 tok（固定費の 59%）**

| ツール | tok | md-DSL 重複 | 備考 |
| --- | --- | --- | --- |
| set_slide_diagram | 408 | **高** — ```diagram/```mermaid フェンスで新規も置換も可（applySlideMarkdown はフェンスがあれば置換・無ければ保持） | 固有価値＝json/mermaid 入力の検証・native YAML 化・placeholderIdx 指定。説明文圧縮の筆頭 |
| apply_design_intent | 336 | 部分 — relayout は DiagramSpec.direction の yaml 編集で可。emphasize/regionSplit は座標計算がエンジン側で md 不可 | 説明文圧縮の次点 |
| insert_slide | 263 | 不可 — set_deck_markdown 全置換でも書けるが他スライドの図が落ちる（surgical 性が本体価値） | |
| move_slide | 260 | 不可（同上） | |
| set_slide_markdown | 258 | —（md-DSL の入口そのもの） | |
| duplicate_slide | 248 | 不可（同上・byte-identical 複製が価値） | |
| delete_slide | 209 | 不可（同上） | |
| convert_bullets_to_table | 203 | **完全** — GFM 表は md-DSL 語彙。AI が自分で書き換えれば足りる | 固有価値＝決定論・往復ゼロ。削除候補（7.4） |
| set_deck_markdown | 202 | —（md-DSL の全 deck 版） | ⚠ D5-3（増分性）に反する「丸ごと再生成」の口。温度はホットだが呼出文脈を監視対象に（乖離③） |
| get_slide | 195 | n/a | §4 どおりホット read の本線 |
| get_slide_image | 201 | n/a | プロファイル依存: U2 では毎指示の視覚確認＝ホット、U1 では GUI が read 面（乖離④） |
| get_slide_html | 178 | n/a | 同上（ブラウザ無し環境向けの R8 兄弟） |
| split_overflowing_slides | 173 | 不可 — 溢れ判定（容量実測）がエンジン側。md では表現不能 | |
| get_slide_fix_request | 132 | n/a | 診断 3 系統の重複。get_slide が issues＋predictedSplit＋markdown を内包済み。削除候補筆頭（7.4） |
| get_slide_markdown | 128 | n/a | get_slide の部分集合。削除候補（7.4） |
| get_deck_issues | 109 | n/a | §4 どおり診断の本線 |

**出口（稀）— 3 本・482 tok**: export_pptx 207・save_project 167・validate_deck 108。§4 どおり健全・現状維持。

**人間側 — 6 本・509 tok**: register_templates 144（既に gui-role 限定登録）・undo 87・select_document 75・
redo 74・close_document 72・list_documents 57。§4 どおり削除しない・プロファイル別登録で solo から隠す。

#### §4 スナップショットからの乖離（較正点）

1. **入口 4 本（open/new/use_template/create_template）が温度表に未分類だった** → コールドに編入。
2. **全 deck read（get_deck/get_deck_markdown）はホットでなくコールド** — 毎指示の全 deck 再読は
   D5-3（増分性）に反する使い方で、想定頻度はセッション初回の全体把握。
3. **set_deck_markdown** はホット登録のまま維持するが、「deck 丸ごと再生成に落ちる操作」の入口
   なので指標計測（D5-3）の監視対象と明記。
4. **get_slide_image / get_slide_html の温度はプロファイル依存**（U2 ホット・U1 では GUI が read 面）。
   プロファイル別登録の設計時に solo/collab で扱いを分ける判断材料になる。

### 7.4 削除候補と証拠要件（D4: 証拠が揃うまで削除しない）

前提: どの候補も読み取り系は [ADR-0008](../adr/0008-mcp-tool-surface-audit.md) の互換性フロア
（読み取りツール削除禁止）に触れるため、削除には証拠＋フロア supersede の個別 ADR が要る。
呼び出し頻度ログの収集基盤は #406 の子タスク「指標の計測手段」へ送る（本監査のスコープ外）。

| 候補 | 重複先 | 削除を正当化する証拠（1 行定義） |
| --- | --- | --- |
| get_slide_fix_request | get_slide（issues＋predictedSplit＋markdown を内包） | 実セッション 20 本以上で呼出率が get_slide の 5% 未満、かつ fix packet 経由の編集が get_slide 経由より成功率で優位でないログ |
| convert_bullets_to_table | md-DSL（GFM 表を set_slide_markdown で自書き） | 呼出頻度ログ＋「AI 自書きの表化」との一致比較（R8 の agreement 形式）で品質同等を確認 |
| get_slide_markdown | get_slide の markdown フィールド | get_slide 導入（ADR-0015）以降の実セッションで呼出が get_slide に吸収されている（併用率 10% 未満）こと |
| get_project_info | （単独・低情報量） | 実セッション 20 本以上で呼出ほぼゼロ（1 セッション平均 0.1 回未満）の確認 |
| ガイド 4（authoring/diagram_types/diagram_guide/template_spec） | bootstrap 統合（D2・削除ではない） | 統合後に旧名 alias の呼出率が 1% 未満に落ちてから alias 縮退を判断（統合自体は証拠不要＝D2 合意済み） |

逆に、**削除候補に挙げない**と明記するもの: 構造 4 本（insert/delete/move/duplicate — surgical 性は
md-DSL で代替不能）・set_slide_diagram と apply_design_intent（重複はあるが検証・座標計算という
エンジン価値が残る。まず説明文圧縮で固定費だけ削る）・出口 3 本・人間側 6 本（D2 で削除しないと決定済み）。

## References

- ADR-0008（ツール面監査・互換性フロア）・ADR-0009（協働ホスト）・ADR-0015（brushup）・
  ADR-0033（単一管制）・ADR-0035/0036（scoped fs・テンプレ discovery）
- 関連 Issue: #220（編集経路の engine 一本化）・#392（ビジュアル並置・SlideIR）・#396–#404（md-DSL 語彙輸入）・
  #406（再設計の親タスク）・#466（§7 の敵対的監査）
