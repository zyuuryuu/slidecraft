# ADR-0023: 素の第三者マスターでの idx-META 規約の適用可否

- Status: Accepted
- Date: 2026-07-07
- Deciders: SlideCraft maintainers

## Context

会社の実テンプレート（CX Sample＝知財情報を剥がした側だけのマスター）を食わせると、**プレビューが追随せず、PPTX 出力でも placeholder に本文が入らない**という不具合が報告された。

原因は `placeholderRole`（テンプレ側の placeholder → ロール分類）の **idx-META 規約**。SlideCraft は自前の canonical マスターで、`type="body"` の placeholder を特定 idx に置いて META を表す:

- idx 10 → category / 11 → date / 12 → footer / 15 → title / 16 → subtitle

canonical では本文は idx 1–9、META は idx 10–16。ところが**素の PowerPoint テンプレート（CX）は本文 placeholder を idx 10 以降に採番する**（PowerPoint の「Text Placeholder」は idx 10, 11, 13… になる）。結果、CX の本文（body#10/11/12/13/16）が category/date/footer/subtitle と誤分類され、content レイアウトの bodyCount が 0 になり、`bindContentByRole` に本文の受け皿が無く、内容が黙って落ちていた。プレビューと出力は同じ `bindContentByRole` を共有するため、両方が同時に壊れていた。

つまり idx-META 規約は **SlideCraft 固有のエンコード**であり、任意のマスターに一律適用してはならない（ADR: harness は INPUT マスターごとに動くべき）。

## Decision

**idx-META 規約は「自前規約に従うマスター」だけに適用する。** テンプレ読込時（`loadTemplate`）に一度判定し、各 `PlaceholderInfo` に `metaIdxConvention` を stamp。`placeholderRole` は `idx==="50"→slideNumber`（普遍・据置）以外の idx-META 分岐（10/11/12/15/16）をこのフラグでゲートする。undefined ⇒ true（synthetic/canonical は byte-identical）。

判定 `usesMetaIdxConvention(layouts)`（いずれか）:
1. **canonical ドット名**（`Family.Detail`）がレイアウトの過半 — 自前 canonical。
2. **型付き META**（`sldNum`/`dt`/`ftr`）を持つレイアウトが過半 — 自前 template-writer 慣習に沿ったマスター（報告書/マガジン等。python-pptx 手製でも規約に沿うものはここ）。

CX（ドット名なし × 型付き META なし）は**どちらも満たさず opt-out** → body#10..16 が本文として束縛され、内容が入る。

docProps の `Application=SlideCraft` マーカーは PowerPoint 再保存で失われる（実際 canonical/報告書とも `Microsoft … PowerPoint` に化けていた）ため**判定に使えない** → 構造シグナルで判定する。

## Consequences

- **CX Sample が動く**：content/columns レイアウトが実 body を持ち、`bindContentByRole`（プレビュー＋出力共有）で title/subtitle/本文が束縛される。end-to-end テストで、生成 slide XML に本文テキストが実在することを検証（`tests/cx-sample-template.test.ts`）。
- **既存 5 系統は byte-identical**：canonical（ドット名）／報告書・マガジン（型付き META で規約 ON、body#15/16=title/subtitle 維持）／velis（型付き META、ただし 10–16 に body/typeless 無し＝規約は no-op）。全 1158 テスト緑、golden 不変。
- **stamp 方式**：`placeholderRole` はテンプレ文脈を持たない純関数のまま。判定結果を placeholder に載せることで、`bindContentByRole`/`buildFieldMap`/`bodyPlaceholders` 等**全呼び出し側のシグネチャを変えずに**規約を伝搬。
- **残存エッジ（既知）**：型付き `sldNum/dt/ftr` を持ち、かつ**本文を idx 10/15/16 に置く**実テンプレートは、規約 ON と判定され body#10/15/16 が META と誤読される可能性がある（束ねられた 5 系統には該当なし）。将来の改良候補：レイアウトが型付き title を持つ場合は idx-15/16→title/subtitle を無効化する per-layout ゲート、または META/本文の GEOMETRY 判定。ユーザ提案の[マスター Re-make（テーマだけ抽出して自前レイアウトを決め打ち）]はこのエッジを構造的に回避する上位案。

## References

- `src/engine/template-catalog.ts`（`usesMetaIdxConvention`, `placeholderRole` のゲート）
- `src/engine/template-loader.ts`（`PlaceholderInfo.metaIdxConvention` の stamp）
- `src/engine/placeholder-binding.ts`（`bindContentByRole` — プレビュー＋出力共有の束縛）
- `tests/cx-sample-template.test.ts`
- 関連: ADR（任意マスター対応・harness over model）、`docs/design/` master intake
