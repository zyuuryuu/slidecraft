# ADR-0032: authoring 記法拡張 — `<!-- note -->` スピーカーノートと `<!-- section -->` 章タグ

- Status: Accepted
- Date: 2026-07-19

## Context

ブリーフィング型デッキの中核原則「スライドは疎に・詳細はノートへ」を成立させる記法が無く
（#150）、章の概念が無いため目次と本文の乖離を構造的に防ぐ手段が無い（#151）。設計にあたり
ユーザ要件として「Markdown の良さを壊さない — 素の Markdown としてレンダリングしても自然に
読めること」を評価軸に加えた。

検討時点の実装事実:

- 未知の HTML コメントはパーサが**破棄**する（#147、`stripCommentOnlyLines`）。往復しない。
- SlideIR / DeckIR にノート・章のフィールドは無い。「section」はレンダー時の一過性ロール判定
  （タイトルのみスライドの自動昇格、`template-loader.ts` `slideRoleRegions`）のみで永続化されない。
- PPTX 主経路（`placeholder-filler.ts generatePptx`）は自前 OOXML 生成で、notesSlide /
  notesMaster パートは完全未実装。
- ADR-0002 により deck（DeckIR）が唯一の源。Markdown は入出力限定で、記法は import 時に
  deck へ畳み込む必要がある。

## Decision

### D1: スピーカーノートは `<!-- note -->` マーカー方式（#150）

```md
# スライドタイトル

- 表に出す要点

<!-- note -->
ここからスライド末尾（次の `---`）までノート。本文は素の Markdown。
```

- マーカーのみ不可視・**ノート本文は通常の Markdown 段落として書く**（Marp 同系）。GitHub 等で
  レンダリングしても本文が自然に読める。既存ディレクティブ（slide:/col/kpi/step/card）と一貫。
- 却下案: `:::note` フェンス（レンダリングで `:::` が生テキスト露出）、`Note:` キー行
  （既存 meta 行は単一行・title 名前空間限定で、複数行ノートと衝突）。
- IR: `SlideIR.notes?: Paragraph[]`（R4 承認済み 2026-07-19）。
- PPTX: notes が空のスライドには notesSlide パートを**一切生成しない** — ノート無しデッキの
  出力不変を構造的に担保。
- HTML export: 既定非表示＋トグル。distill 分割時は**先頭チャンクのみ**に残す（複製しない）。

### D2: 章は「著者が書く章扉スライド」への `<!-- section -->` タグ（#151）

```md
---
<!-- section -->
# 現状分析

> 章の補足説明（任意）
---
```

- **章扉は生成物ではなく著者のスライド**。タグは章境界の宣言のみ。章名は `#` 見出しとして
  Markdown に残る（レンダリングで章構造が見える）。
- Issue #151 原案（`<!-- section: 名前 -->` から章扉を丸ごと自動生成）は却下。理由は実装量では
  なく構造: ADR-0002 の下では生成スライドも GUI エディタで見え編集できてしまうが、編集結果を
  コメント 1 行に畳み戻せない。捨てれば no-silent-drop（ADR-0030）違反、保持すればデタッチ規則
  という新しい問題クラスが要る。著者スライド＋タグならこの問題クラスが存在しない。
- タグから決定論で導出するもの: **章番号自動採番**（出現順）と**目次**。
- 目次は `<!-- toc -->` のみのスライドブロックで宣言し、内容は常に section タグ付きスライドの
  タイトルから**再導出**する派生スライドとする。Markdown へは `<!-- toc -->` の 1 行のみ書き戻す。
  目次スライドの手編集は不可（乖離防止の核なので導出専用に倒す）。
- IR: `SlideIR.sectionBreak?: boolean` / `SlideIR.derived?: "toc"`（R4 承認済み）。章一覧は
  毎回スキャンで導出し、**DeckIR に章構造の複製状態を持たない**（R8）。
- 初期スコープは章扉タグ＋採番＋目次まで。アジェンダ再掲（「全章リスト＋現在章強調」レイアウト
  が未存在で新設が先行依存）とフッタ章名（`Footer:` の title 名前空間ゲート・chrome 判定
  do-no-harm と正面衝突）は**別 issue** に切り出す。
- `<!-- slide: -->` ピンとは直交: 章扉も通常どおり auto 解決（role=section）またはピン固定可能。
  既存の「タイトルのみスライドの section 自動昇格」ヒューリスティックは当面残す。

### 共通の不変条件

- 新記法を含まない Markdown の parse → export 出力は **byte-identical**（新コードパスに入らない）。
- `<!-- note -->` / `<!-- section -->` / `<!-- toc -->` を `DIRECTIVE_COMMENT_RE` の許可リストに
  追加（#147 の破棄機構と両立）。authoring guide（`slideSystemPrompt`）と
  `authoring-contract-roundtrip.test.ts` のドリフトゲートを同時更新する。

## Consequences

- ブリーフィング型プロファイル（疎スライド＋厚ノート）が成立する。目次は宣言から常に導出され、
  本文との乖離が構造的に起きない。
- `tests/md-comment-drop.test.ts` が `note` を「破棄される例」に使っているため、例語の差し替えが
  必要（テスト改訂はユーザ承認済み 2026-07-19）。
- notesSlide パート追加は PPTX zip の触点（Content_Types / rels / パージ範囲）を増やす。
  ノート無しデッキの出力不変テストで退行を防ぐ。
- アジェンダ再掲・フッタ章名は本 ADR のスコープ外。着手時は SectionNav 系レイアウト新設と
  meta 経路再設計をそれぞれ独立に設計する。

## References

- Issue #150（スピーカーノート記法）・#151（セクション記法と構造要素の自動生成）
- ADR-0002（deck が primary surface）・ADR-0011（placeholder⇄入力の検証済み全単射）・
  ADR-0030（BindingPlan 単一権威・no-silent-drop）・#147（コメント破棄機構）
