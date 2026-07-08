# 設計: AI による非決定 Re-make（第3の取り込み口）

- Status: Draft（設計中・未実装）
- Date: 2026-07-08
- 関連: [ADR-0023](../adr/0023-third-party-master-idx-convention.md)（決定論 Re-make）／[ADR-0014](../adr/0014-template-authoring.md)（AI が spec 提案）／[ADR-0018](../adr/0018-validation-at-adoption-gate.md)（採用ゲート）／[ADR-0005](../adr/0005-harness-over-model.md)（harness over model）／[ADR-0025](../adr/0025-placeholder-role-resolution.md)＋layout Tier1/2（不整合対処）

## 1. 目的

スライドマスターの取り込みは現在2択:

1. **丸ごと忠実 Import** — 元マスターの構造をそのまま使う。柔軟だが、乱雑な第三者マスターは
   ロール/レイアウト/idx が不定で、**実行時にヒューリスティックで“解釈”**する必要がある
   （ADR-0025 の title リカバリ、layout 選出 Tier1/2 の gate 群がこの解釈の継続対処）。
2. **決定論 Re-make**（[ADR-0023](../adr/0023-third-party-master-idx-convention.md)） — テーマ（フォント/配色/ロゴ）だけ抽出し、
   **固定の 30 canonical レイアウト**に載せ替える（`masterToTemplateSpec` → `writeTemplate`）。
   clean だが **rigid**：元マスター固有のレイアウト構造・意図を捨てる。

**第3の口＝AI による非決定 Re-make**：元マスターの**レイアウト構造/意図を汲みつつ、ロールは
clean（canonical 型）**に再著述する。忠実（柔軟だが乱雑）と決定論 Re-make（clean だが硬直）の
中間を埋め、**不整合を実行時解釈でなく取り込み時に一度で解消**する。

## 2. 現状（既にある部品）

AI Re-make は**新規構築ではなく、既存2経路の合流**である:

| 部品 | 役割 | 場所 |
| --- | --- | --- |
| `masterToTemplateSpec(tpl)` | 決定論抽出: master → `TemplateSpec`（**theme のみ**: fonts/palette/logo/flatContent。layouts は付けない＝固定30使用） | `master-remake.ts:83` |
| `TemplateSpec` / `LayoutDef` | `writeTemplate` が食う契約。`layouts?: LayoutDef[]` は**任意**（省略時 built-in 30）。`LayoutDef = { name, family, decos?, placeholders: LayoutPhDef[] }` | `template-writer.ts` / `template-layout-library.ts` |
| `writeTemplate(spec)` | TemplateSpec → OOXML（.pptx） | `template-writer.ts` |
| AI `template-spec` モード | 自然言語 → `TemplateSpec` の AI 提案。**現状 `{name, fonts, palette}` のみ**（layout 非対応）。防御的パース＋**contrast-guard**（`guardContrast`）で常に使える spec に落とす | `template-spec-prompts.ts`・`llm-prompts.ts` |
| `assessTemplateHealth` | title/body ロール等の健全性ゲート | `template-loader` / `template-catalog` |
| 採用ゲート・best-of-N・自己修復 | AI 出力の検証→採用/却下/再試行（[ADR-0018](../adr/0018-validation-at-adoption-gate.md)・[ADR-0019](../adr/0019-partial-edit-ops.md)） | `ai-apply` 系 |

**ギャップ**: AI は現在 **theme しか著述しない**。不整合の主因である**レイアウト構造/ロール**を
AI が clean に再構成する層が無い。

## 3. データフロー（提案）

```
元マスター(.pptx/.potx)
  │
  ├─(決定論) masterToTemplateSpec → theme(fonts/palette/logo/flatContent)   ← 既存・そのまま seed
  │
  ├─(決定論) レイアウト在庫の抽出 → LayoutInventory[]                        ← 新規（下記）
  │     各 source layout: {name, placeholders:[{type,idx,role推定,geometry,textStyle}], hasLogo, family推定}
  │
  ▼
AI（template-spec 拡張 or 新 remake モード）
  入力: theme + LayoutInventory（コンパクトにトークン化）
  出力: layouts: LayoutDef[]（clean・canonical 型のロール割当）
  │
  ▼
ハーネス（決定論・harness over model）
  ① スキーマ/JSON 検証（防御パース）
  ② geometry サニティ（スライド内・最小サイズ・重なり過大を弾く/クランプ）
  ③ ロール完全性（assessTemplateHealth: title/body 必須）
  ④ contrast-guard（既存流用）
  ⑤ writeTemplate → loadTemplate 往復（実際に生成・再読込できるか）
  │
  ├─ 通過 → TemplateSpec{ theme, layouts } 完成 → 採用ゲート（best-of-N / 自己修復1回）
  └─ 失敗（N 回）→ **決定論 Re-make にフォールバック**（固定30）＝ 現状より悪くならない floor
```

**不変条件**: AI Re-make は決定論 Re-make の**上位互換**。AI が使える layouts を出せなければ
必ず決定論結果に落ちる（never worse）。

## 4. 核心の決定事項 ― AI はどこまで所有するか

「AI が LayoutDef を著述」の**粒度**が設計の肝。3案:

- **A. theme-seed のみ（最小）** — AI は色/フォントだけ（元マスターの事実で seed）。layouts は決定論
  固定30のまま。実装小・低risk だが**レイアウト柔軟性ゼロ＝ユーザの狙いを満たさない**。
- **B. フル layout 著述** — AI が `LayoutPhDef` の**幾何（x/y/w/h/フォント/色）まで**生成。最も柔軟だが、
  (i) 小モデルには幾何生成が難しく品質不安定、(ii) 検証負荷大、(iii) harness-over-model と逆行。
- **C. 構造マッピング（推奨）** — AI は**「この source layout ≒ どの canonical レイアウト構造か＋各枠の
  ロール」だけ**を決める。**幾何/スタイルは canonical ライブラリ（決定論）**が供給。
  - 例: source の「比較スライド」→ `Column.2Body.Equal` に写像＋左右 body に role 割当。
  - 小モデルでも可能（分類＋ロール付けは色提案と同程度の難度）＝ **harness-over-model 準拠**。
  - **不整合を取り込み時に一度で clean 化**（実行時ヒューリスティック＝ADR-0025/Tier1/2 の負担を軽減）。
  - 柔軟性: 固定抽出より source の意図に沿ったレイアウト選択・追加ができる（例: source 固有の
    レイアウトを最も近い canonical に写し、無ければ「近い family＋枠数」で合成）。
  - **B の幾何生成は将来 Phase**（canonical に無い真に固有な構造が必要になった時）。

→ **推奨は C**（構造マッピング）。layout-selection の `classifyLayout` を「実行時ヒューリスティック」
から「取り込み時 AI＋人間確認」へ前倒しする発想で、今直している不整合の**予防**になる。

> **決定（2026-07-08・ユーザ）: C を採用。**

### 4.1 C の詳細設計

C の本質は **「AI 支援のレイアウト・サブセット選択＋ロール写像を、元マスターのレイアウト在庫で
seed する」**。**幾何/スタイルは canonical ライブラリ（決定論）が供給**し、AI は「どれを・どう
使うか」だけを決める。既存部品を最大流用:

- **入力（決定論・新規 `masterToLayoutInventory`）** — 各 source layout の要約:
  `{ srcName, family:"dark|light", hasLogo, phs:[{ type, idx, roleGuess(=placeholderRole), box, fontSizeish, span }] }`。
  loader の既存抽出（placeholders/geometry）＋ `placeholderRole` をそのまま使う。
- **AI 契約（新 `remake` プロンプト or template-spec 拡張）** — 入力＝上記 inventory ＋
  **canonical レイアウト語彙**（`BUILTIN_LAYOUTS` の名前・role・region 数）。出力（JSON）＝
  source レイアウト群を canonical 語彙に写した**選択＋ロール上書き**:
  ```json
  { "layouts": [
      { "base": "Column.2Body.Equal", "rename": "比較", "roles": { "2": "body", "3": "body" } },
      { "base": "Section.1Divider.Single", "rename": "章扉" }, … ] }
  ```
  幾何は base（canonical LayoutDef）から。`roles` は base の枠 idx→role の**曖昧時のみ**上書き。
- **合成（決定論）** — 選ばれた base 群 ＝ `TemplateSpec.layouts`（既存の**サブセット選択機構**
  ＝ADR-0014 PR #77 と同じ土台）に theme（`masterToTemplateSpec`）を載せ、`writeTemplate`。
- **ハーネス** — §3 の①〜⑤（スキーマ／base 名が語彙内か／role 完全性／contrast／往復生成）＋
  **決定論フォールバック**（AI が空・不正なら固定30）。best-of-N は既存流用。

要は **AI＝分類器（色提案と同難度）**、**幾何・生成・検証＝決定論**。harness-over-model に忠実で、
「乱雑 source を取り込み時に一度で canonical へ写す」ことで実行時ヒューリスティックの負担を消す。

## 5. フェーズ

- **Phase-0 スパイク（feasibility）** — 実テンプレで、決定論抽出した LayoutInventory を
  ローカル小モデルに渡し、案 C の写像を出させ、検証通過率・往復生成成功率・目視品質を測る。

  > **結果: GO（実測 2026-07-08）。** `src/engine/master-remake-ai.ts`（決定論スカフォールディング・
  > test-first）＋ Ollama スパイクで **CX_sample（22 レイアウトの乱雑第三者マスター）× `granite4.1:8b`
  > （小モデル 5.3B）** を実行:
  > - **valid JSON・全 base が語彙内（ハルシネーション 0）・写像は妥当**（~20–37s）。決定論のロール
  >   推定より賢い例も（「Title_2 column bullet text」→ `Column.2Body.Equal`、「Closing slide」→
  >   `Closing.1Message.Single`、role≈title と誤抽出した「…chart」→ content 系）。
  > - 合成 → `writeTemplate` → `loadTemplate` **往復成功**、`assessTemplateHealth`=**ok**
  >   （`usableKinds: title/content/columns/closing`）。**合成後のロールが clean で正しい**＝
  >   取り込み時に不整合が消える（実行時ヒューリスティック不要）。
  > - 壊れ/空/全ハルシネーション応答 → **決定論フォールバック**の floor もユニットテスト済（never worse）。
  > - **結論**: 小モデルでも実用品質・harness で担保・never worse。**GO**。
  > - **Phase-1 への知見**: `composeRemakeLayouts` の dedup が **base 単位**なので 22→7 に collapse
  >   （複数 Segue→1 SectionNav で source の layout 名が失われる）。Phase-1 は **name 単位 dedup**
  >   （同一 base に複数レイアウトを許し source 名を保持）に。プロンプトに「役割の根拠を一言」を
  >   足すと説明可能性↑。より弱い/多様なモデル（phi3.5 3.8B 等）でのばらつきも計測する。
- **Phase-1 MVP** — 案 C を実装（LayoutInventory 抽出＋新プロンプト＋検証＋決定論フォールバック）。
  UI は Re-make の第3選択肢（「AI で作り直す」）。best-of-N は既存機構を流用。
- **Phase-2 磨き込み** — 案 B の部分導入（canonical に無い固有構造の合成）、EA/CJK フォント連携
  （Re-make 残 A）、per-background ロゴ（残 B）。

## 6. 検証・テスト（harness over model）

- 純ロジック（R2）：LayoutInventory 抽出・LayoutDef 検証・geometry クランプ・フォールバックは
  決定論でユニットテスト。
- AI 層はテスト用に**固定応答モック**＋「壊れた応答でも floor に落ちる」不変条件テスト。
- **golden**: AI Re-make はプレビュー/PPTX 生成に載るので、決定論フォールバック経路は既存 golden 不変。
  AI 経路は「生成物が loadTemplate 往復＋health を通る」ことをアサート（決定的な出力比較はしない）。
- alien テンプレ群で「AI Re-make 後に本文/タイトルが正しく bind する」ことを検証（不整合解消の実証）。

## 7. リスク・未解決

- **小モデルの幾何生成は不安（→ 案 C で回避）**。案 C でも「source layout の要約トークン化」を
  どこまで圧縮するかで品質が変わる。Phase-0 で詰める。
- **価値の源泉**: 多くの実マスターは canonical に十分近く、決定論 Re-make で足りる可能性。
  AI が効くのは「canonical に無い固有レイアウトを持つマスター」。Phase-0 で対象マスターの
  “固有度”も測る（AI を出す価値があるか）。
- **UX**: 忠実 / 決定論 Re-make / AI Re-make の3択は迷いを生む。既定の推奨フロー（まず決定論、
  不満なら AI）を明確化。人間の最終確認（プレビュー）は必須。
- **非決定性の説明可能性**: 「なぜこの写像にしたか」を軽く提示できると信頼が上がる（任意）。

## 8. 次アクション

1. この設計の**方針確定**（特に §4 の A/B/C＝推奨 C）。
2. Phase-0 スパイクの実装（feasibility 計測）→ GO/NO-GO。
3. GO なら ADR 化（決定の記録）＋ Phase-1 MVP を test-first で。
