# ADR-0029: 表紙 subtitle の gated リカバリ — rung は idx 規約のみ（幾何は採らない）

- Status: Accepted
- Date: 2026-07-17
- Supersedes: なし（[ADR-0025](0025-placeholder-role-resolution.md) の Phase 2 を subtitle へ拡張。[ADR-0023](0023-third-party-master-idx-convention.md) の制約下での決定）

## Context

[ADR-0025](0025-placeholder-role-resolution.md) は「title は重要属性なのであらゆる手段で特定する／ただし gate 付き」で
`recoverLayoutTitle` を入れ、**subtitle は YAGNI** と明記してスコープ外にした。その後、型を潰した表紙の実測で
同型の穴が subtitle にも空いていることが分かった（#125）。`ctrTitle`（表紙）配下のサブタイトル枠が
**body 型 / 型なし**だと `role="body"` になり:

1. subtitle content が**未束縛**（表紙のサブタイトルが画面に出ない）
2. その枠が**箇条書きを吸う**（body 枠として content を受ける）＝ title 消失より悪い

根本原因は「推定の不足」ではなく **binding 両側の非対称**だった。content 側 `slideIdxRole` は既に
「`ctrTitle` のレイアウトなら idx 1 = subtitle」と言っているのに（`case "1": return hasCtrTitle ? "subtitle" : "body"`）、
layout 側 `placeholderRole` は `type="body"` / idx 1–9 を**絶対**で body と読む。左右が食い違えば
ADR-0011 の全単射は成立しない。

### 幾何 rung を足すと壊れるもの（実測）

#125 の起票時は「gate を『`ctrTitle` を持ち subtitle ロールが無い時だけ』にすれば全 403 レイアウトで
発火 0＝ byte-identical」という前提だった。**この前提は誤りだった**。実コーパス 404 レイアウトを実測すると、
その gate だけでは **CX_sample_MSGothic の Quote slide 3 枚が発火**する:

```
[Quote slide_white] ctrTitle idx=0 (引用文  y=2.25 h=3.32 fs=54)
                    body    idx=11 (帰属行  y=6.04 h=0.51 fs=28)
```

この帰属行は「title の下・低背・title より小フォント」という**素直な subtitle 幾何と区別できない**。
しかし同時に、[ADR-0023](0023-third-party-master-idx-convention.md) で「素の第三者マスターの body 型 idx-10+ は
**CONTENT** として束縛する」と決めた枠そのものでもある（それが CX の content 束縛とプレビュー追従を成立させている）。
fs 比（CX 28/54=0.52 vs 実 subtitle 0.26–0.45）で閾値を切れば分離自体はできるが、**敵対サンプル 1 件に
合わせた magic number** であり、次の第三者マスターで再発する形をしている。

## Decision

`recoverLayoutSubtitle` を追加し、[ADR-0025](0025-placeholder-role-resolution.md) Phase 2（layout 単位・取込時確定・
gate 付き昇格）の枠組みをそのまま subtitle へ広げる。**ただし rung は idx 規約のみとし、幾何 rung は採らない。**

```
promote (role := subtitle) IF
   layout が ctrTitle を持つ                          ← gate（表紙のみ）
   AND layout に role=="subtitle" が皆無              ← gate（本物の subtitle は絶対に奪わない）
   AND ph.idx == "1"                                  ← rung: PowerPoint の subtitle スロット
                                                          ＝ slideIdxRole の content 側規約と対称
   AND ph の base role が body / other                ← 非 meta のみ（date/footer 等は不可侵）
   AND NOT isChromeBand(ph.style)                     ← 装飾帯は subtitle ではない（#96 の教訓）
```

- 確定は **template-loader の取込時**（`recoverLayoutTitle` と同じループ）に行い、勝者に `resolvedRole="subtitle"` を刻む
  → binding / catalog / fieldMap が同一ロールを見る（ADR-0011 全単射）。冪等。
- **幾何 rung は意図的に採らない**。「幾何では第三者マスターの帰属行と subtitle を分離できない」ことが実測で分かっており、
  ADR-0023 の契約を守る方を優先する。**idx-1 規約は、この局面で唯一 authorial intent を運んでいる signal**である。

## Consequences

- **修正**: `ctrTitle` ＋ 型なし/body 型 idx=1 の表紙で subtitle が束縛され、箇条書きを吸わなくなる（#125 の受け入れ基準）。
- **健全テンプレ不変**: 実コーパス 404 レイアウト（同梱 4 ＋ fixtures ＋ test-data）で**ロール変化 0**。健全な表紙は
  `subTitle` 型を持つので gate が発火しない → 束縛・golden は byte-identical。テストがこの不変条件を直接ゲートする。
- **ADR-0023 を守る**: CX Quote の idx=11 は body のまま＝第三者マスターの content 束縛は不変。
- **受け入れた劣後（forced-suboptimal）**: **型なし非規約 idx（例 idx=20）の表紙 subtitle は未復元のまま**（#128）。
  「幾何で拾えば直る」が、それは ADR-0023 を壊す。**この制約下では 3 パターン中 2 つの復元が最善**という判断であり、
  残り 1 つは「実マスターでの発生証拠」＋「CX と両立する分離規則」が揃うまで**意図的に開けてある**。
  幾何 rung を足したくなった将来のセッションは、まず CX Quote の実測（上表）を再現すること。
- **scorer では直せない**: `master-scorer` の subtitle 判定は confidence 0.5 固定かつ窓が `y < 0.4*SH` で、
  実サブタイトル（y=4.05）は窓の外 → #98（scorer 復元の拡張）とは独立（#125 に実測済）。

## References

- [ADR-0025](0025-placeholder-role-resolution.md)（gate 付き title リカバリ／本 ADR はその subtitle 版・「subtitle は YAGNI」を解除）
- [ADR-0023](0023-third-party-master-idx-convention.md)（第三者マスタの idx 規約 gate — 幾何 rung を退けた理由）
- [ADR-0011](0011-placeholder-input-bijection.md)（placeholder⇄入力の全単射・単一ロール関数）
- `src/engine/template-catalog.ts` `recoverLayoutSubtitle` / `slideIdxRole`、`src/engine/template-loader.ts`（取込時 stamp）
- `tests/subtitle-role-recovery.test.ts`（コーパス・ロール不変／CX Quote 保護／sanitize-twin のローダー経路）
- #125（本体）／#128（残り: 非規約 idx）／#96（ラダーと scorer の chrome 定義一本化）
