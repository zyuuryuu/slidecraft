# ADR-0027: Re-make v2 — ソース視覚層の保持＋幾何ベース Placeholder 識別

- Status: Accepted
- Date: 2026-07-08
- Supersedes (部分): [ADR-0026](0026-ai-remake.md) の「AI が canonical base を選び、幾何・装飾は canonical 側から取る」（option C）part

## Context

AI Re-make（ADR-0026 / option C）は、ソースの各レイアウトを組み込み canonical レイアウトに
**写像**し、幾何・装飾・背景は **canonical 側**から取る。renaming で名前は残るが、
`composeRemakeLayouts` は `{...canonicalBase, name}` を返すため、**ソースの実際の視覚層
（装飾シェイプ・背景・図版・placeholder 幾何）は全て捨てられる**。

実データ（`配布資料_公文書高密度_TemplateOnly.pptx`）で計測すると、このテンプレの「らしさ」は
**per-layout の装飾シェイプ 85 個**（帯・箱・パネル）に集約されており、master 背景画像・画像
アイコンは 0。canonical 写像はこれらを canonical のヘッダーバー1本に置換するため、出力が
plain になり「元テンプレに見えない」。

ユーザ FB（実機・2026-07-08）：「AI Re-make の精度が不満。純粋 Import はテスト済で忠実に動く。
**その純粋 Import を活かして、せめてある程度トレースできる精度に**」「（幾何を保持するなら）
**その幾何情報に基づく適切な Placeholder 識別も必須**」。

純粋 Import は既に **ソースの視覚 XML（装飾・背景・図版・幾何）を忠実に読み取り・描画**できて
いる（[[html_output_design]] の SlideCard がそのまま出力＝WYSIWYG）。プロトタイプで、ソース
zip の `theme1.xml`（fontScheme）だけ差し替えても **13 レイアウト・85 装飾・背景・幾何・health=ok
が完全保持**されることを確認した。

## Decision

**Re-make を「canonical への写像」から「ソース視覚層の保持＋正規化」へ作り替える。**

1. **視覚層はソースを保持**：純粋 Import の読み取りを土台に、レイアウトの幾何・装飾・背景・図版を
   そのまま維持する（＝装飾＝ブランドが消えない）。実装は DecoRect からの再出力（custGeom/gradient
   移植は損失・高リスク）ではなく、**ソースの実 XML を保持**して達成する。
2. **タイポグラフィだけ正規化**：テーマの fontScheme を実フォント名へ解決（`+mj-lt`→実名・EA 保持・
   [[feedback_lstyle_hardcode]]／ADR-0027 前段の EA 修正）。ブランド配色（装飾の hardcode 色）は
   保持する（＝トレース）。
3. **幾何ベース Placeholder 識別を中核に据える（ユーザ要件）**：ソース幾何を保持する以上、
   「どの placeholder がタイトル／本文か」を**幾何情報**（位置・サイズ・peer 構成）で堅牢に同定
   できることが load-bearing。既存資産（[ADR-0025](0025-placeholder-role-resolution.md) の gate 付き
   title リカバリ・Tier1/2 の `peerBodyCount`/`bestBodyBearing`・`placeholderRole`/`classifyLayout`）
   を土台に、必要なら強化する。ここが崩れると ADR-0023 のロール曖昧問題が再来するため最優先。
4. **AI の役割を移す**：option C の「幾何選択（canonical base 選び）」から、
   **曖昧ロールの整理・レイアウト命名**へ。幾何は決定論で保持し、AI は判断が要る所だけ。

## Consequences

- **忠実度が最大化**：装飾・背景・図版・幾何がソースそのまま＝「その会社のテンプレに見える」。
- **canonical の“整った”保証は薄れる**：ソースの構造をそのまま持つため、乱雑なソースの構造も
  引き継ぐ。代わりに幾何ベースのロール識別で「使える」ことを担保する。
- **ロール識別が load-bearing**：faithful 経路の成否は placeholder 識別の堅牢性に依存する。
  これは Import にも効く共通改善（loader の `placeholderRole`/`classifyLayout`）。
- **option C は選択肢として残せる**：「乱雑を整った canonical に寄せたい」用途には canonical 写像が
  依然有効（ADR-0026）。既定は faithful、canonical は「整理重視」オプション（将来 UI）。
- **段階導入**：P1=視覚保持＋フォント正規化（本 ADR の中核）、P2=幾何ベースロール識別の強化、
  P3=AI 補助（曖昧ロール/命名）。

## References

- [ADR-0026](0026-ai-remake.md)（AI Re-make option C — 本 ADR が幾何部分を supersede）
- [ADR-0025](0025-placeholder-role-resolution.md)（gate 付き title リカバリ＝幾何ベース識別の土台）
- [ADR-0023](0023-third-party-master-idx-convention.md)（第三者マスターのロール曖昧問題）
- 設計メモ: [[master_intake_workflow]]／[[guardrail_any_template]]
