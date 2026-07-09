# ADR-0028: AI Re-make（option C）の撤去

- Status: Accepted
- Date: 2026-07-09
- Supersedes: [ADR-0026](0026-ai-remake.md)（AI 非決定 Re-make・option C＝構造マッピング）

## Context

ADR-0026 で AI Re-make（option C）を導入した：AI が入力マスターの各レイアウトを組み込み canonical
レイアウトへ**写像**し、幾何・装飾は canonical 側から取る。v0.3.0 ドラフトの目玉だった。

しかしその後の実機フィードバックと検証で、この AI の使い所が痩せたことが判明した：

1. **[ADR-0027](0027-remake-source-visual-preservation.md) faithful Re-make** が「源のデザインを保ちたい」
   を上位互換で満たす（装飾・背景・幾何を保持）。option C は canonical へ写すため源の視覚層を捨てる。
2. **決定論 Re-make**（`masterToTemplateSpec`→`writeTemplate`）が「綺麗に作り直したい」を AI 無しで満たす。
   option C が足すのは「源の layout 集合に合わせて canonical を subset＋改名」だけ＝薄い。
3. **構造グルーピングは決定論 `detectGroups` が既に解けている**（card/step/kpi/compare を正しく認識・
   `parse-audit` の `grp=` で可視化）。option C が担うはずだった「理解」をハーネスが既にやっている。
4. **実害**：非決定性＋「決定論フォールバック」表示の混乱（ユーザが最初に不満だった点そのもの）。

要するに option C は**"間違った AI の使い所"**——canonical 写像は「理解の補完」ではなく別物で、整理した
どの課題（[docs/design/ai-import.md](../design/ai-import.md) §2 の語彙外構造/曖昧ロール/意味/装飾境界）も
解いていない。

## Decision

**AI Re-make（option C）をユーザ導線ごと撤去する。** マスター取り込みは
**忠実 Import／faithful Re-make（ADR-0027・デザイン保持＋フォント正規化）／決定論 Re-make（テーマ→
canonical）** の整理された選択肢に統一する。

削除：`src/engine/master-remake-ai.ts`（vocabulary/inventory/prompt/parse/compose/best-of-N/aiRemakeSpec）、
`applyTemplateBytesAsRemakeAI`・`applyMasterBytesAsRemakeAI`、`handleRemakeMasterAI`・`REMAKE_BEST_OF_N`、
MasterPicker/InitializeModal の「✨AI で作り直す」導線＋`aiReady` ゲート、`master-remake` AiMode/ipc/
systemPrompt、取り込み結果バーの写像表/usedAi/mappings、関連 i18n・テスト。決定論/faithful 経路
（`master-remake.ts`・`faithful-remake.ts`）は温存。

**AI は撤去だが、"取り込みの理解を助ける" 方向（AI-Import comprehension）は正しい使い所として温存**する
——語彙外構造・曖昧ロール等、**決定論が実テンプレで実際に失敗する証拠（`npm run parse-audit` の
binding correctness）が出た時に**、蒸留→AI→検証→人間確認のハーネス（design §3）で導入する。

## Consequences

- **product が明確化**：取り込みは「保つ(faithful)／作り直す(決定論)」の2軸。半端な AI Re-make の混乱が消える。
- **v0.3.0 は再定義**：目玉を「faithful Re-make（ADR-0027）＋取り込み精度 P1」に。タグ再発行時に本撤去を含める。
- **失った価値は小さい**：canonical 写像の唯一の売り（源 layout 集合の subset＋改名）は faithful/決定論で代替。
- **AI の再登場条件は data 駆動**：`parse-audit` で語彙外/曖昧の binding 失敗が実証されたら AI-Import
  comprehension として設計・導入（design/ai-import.md §5-6）。ADR-0026 の設計資産（distill・validate-and-
  retry・never-worse）はその時に再利用できる。

## References

- [ADR-0026](0026-ai-remake.md)（撤去対象・本 ADR が supersede）
- [ADR-0027](0027-remake-source-visual-preservation.md)（faithful Re-make＝「保つ」を担う）
- [docs/design/ai-import.md](../design/ai-import.md)（AI の正しい使い所＝理解の補完・data 駆動）
