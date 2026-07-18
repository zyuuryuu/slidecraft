# ADR-0030: BindingPlan＝束縛の単一 authority（段階的ロールアウト A–E）

- Status: Accepted（段階A–B 実装済＝PR #152/#156・C–E は後続 Issue）
- Date: 2026-07-18
- Supersedes: なし（[ADR-0011](0011-placeholder-input-bijection.md) の全単射を「観測可能な単一プラン」へ拡張）

## Context

content→placeholder の対応（どの内容がどの枠に入るか）は、ルーティングの source of truth こそ
`bindContentByRole`（テキスト）＋ `expandGroups`（グループ）に集約されているが、その**結果を各所が独立に
再計算・再観測**している。実測した再計算/再観測サイト:

1. `placeholder-filler.ts:145` — export の dispatch（`groupKind && isGroupedLayout ? expandGroups : bindContentByRole`）
2. `SlidePreview.tsx:199` — preview の dispatch（同じ分岐を別実装で再掲）
3. `placeholder-binding.buildFieldMap` — エディタの field-map（probe で束縛を再シミュレート）
4. `placeholder-binding.unboundContent` — drop 検出（`bindContentByRole` を内部で再実行）
5. `visual-placement.ts` — 図/表ルート（body ordinal を別途算出）
6. `group-binding.expandGroups` — グループルート（メタは内部で `bindContentByRole` を再呼び）
7. `deck-diagnostics.ts` — 診断は `slide.placeholders` のロールを直接読み、**束縛を観測していなかった**
8. `contentIdxForPlaceholder` — 逆写像（editor→content idx）

この分散が実害を生んでいる:

- **#124**: テキストと図で別ルートに同じガードを入れ忘れ → 図だけ誤った header 帯に流れた。
- **#135**: グループ数 > レイアウト本文枠数で超過グループが **silent-drop**。`unboundContent`（no-silent-drop
  プリミティブ）は存在するのに**どこにも surface されていない**（#97）ため、`newProject`/`get_deck_issues`/
  `validate_deck` すべてが空を返し、作者にも上流 AI にも知らされずに内容が消える。
- **#128**: `ctrTitle` 表紙で型なし非規約 idx のサブタイトル枠が未束縛 → 表紙のサブタイトルが**消える**。やはり無言。

根本は「推定の不足」ではなく、**束縛の結果を一箇所で観測する型が無い**こと。ルーティングは 1 本でも、
「割当（assignments）／未束縛（unbound）／未充填（unfilled）」という**観測可能なプラン**が無いため、
no-silent-drop の信号（`unboundContent`）が配線されないまま眠っていた。

## Decision

束縛の**観測結果**を表す単一の型 `BindingPlan` を導入し、既存プリミティブの**合成（観測）**として構築する。
新しい割当ロジックは書かない ＝ ルーティングは唯一 `bindContentByRole`/`expandGroups` のまま。

```ts
interface BindingPlan {
  assignments: Array<{ content: ContentRef; placeholder: PlaceholderRef }>; // 割当
  unbound: ContentRef[];      // どの枠にも入らなかった内容（＝no-silent-drop の信号）
  unfilled: PlaceholderRef[]; // 内容を受けなかった枠（観測用）
}
```

- `resolveBinding(slide, layoutPlaceholders)`（`placeholder-binding.ts`）＝**非グループ**の観測。
  `bindContentByRole` ＋ `unboundContent` の合成。`assignments` は `bindContentByRole` の Map から直接組む
  ので **byte-identical**。
- `slideBindingPlan(slide, layout)`（`group-binding.ts`）＝ export/preview と**同一の dispatch** を BindingPlan
  に持ち上げる。非グループは `resolveBinding` に委譲、グループは当面 `expandGroups` の結果を同じ envelope に
  **写すだけ**（統合は段階E）。診断が export の実挙動と一致することを保証する。

### 段階的ロールアウト（A–E）

| 段階 | 内容 | Issue |
|---|---|---|
| **A** | 観測ラッパ（`resolveBinding`/`slideBindingPlan`）導入 ＋ 診断配線（unbound を warn 化）。**挙動変更は「診断が増える」のみ・束縛は byte-identical** | #145（本 ADR） |
| B | serializer を BindingPlan 経由へ置換 | #144 |
| C | #135 の根治（グループ超過の幾何 split／実グループ数での region 数え） | #135 |
| D | `buildFieldMap` を BindingPlan の上に載せる | — |
| E | group-binding 統合（`expandGroups` を BindingPlan に一本化） | — |

### 段階A の絶対不変条件

- **束縛結果は byte-identical**。観測ラッパは既存プリミティブを**再呼び**するだけで、新ルーティングを書かない。
- 診断は `layouts` が渡された時だけ走る（`diagnoseDeck` の 3 引数目）。既存の 2 引数呼び出しは全て byte-identical。
- **test-first（R3）**・R1（400 行）。`unboundContent` の論理は複製せず合成で書く。

### 証拠ポリシーの層別（層1 / 層2）

着手に「実マスター由来の発生証拠」を要するかは、**変更が触る層**で決まる。この層別は段階A限定ではなく、
本 ADR が束ねる refactor 全体（A–E）に適用する一般則である。

- **層1（ロール推論＝復元 rung の追加・変更）**は従来どおり**実マスター由来の証拠を要する**（[#116](https://github.com/zyuuryuu/slidecraft/issues/116) / [#128](https://github.com/zyuuryuu/slidecraft/issues/128) の着手ゲートを維持）。推論の閾値は敵対サンプル 1 件に引きずられると健全マスターを壊すため、病理の**実在**を問う。
- **層2（配管＝束縛結果の運搬・観測・逆写像）の不変条件違反（silent drop / 写像乖離）は、合成 fixture による
  再現で着手可**とする。運ぶべき結果は既にルーティングが確定させており、病理の実在を問う必要がないため
  （`Dirty_Legacy43` 等の合成台で repro を書いてよい）。

**段階 B–E はすべて層2に属する**（serializer 運搬・グループ統合・逆写像 `buildFieldMap`）。したがって段階A同様、
受け入れテストは合成 fixture で着手してよい。段階A は純観測＝束縛の実挙動を変えないので、この層2ルールの最も
単純な事例にあたる。

## Consequences

- **#97 ②a が surface される**: `get_deck_issues`（`getDiagnostics`）が「内容 N 件がこのレイアウトに入りません
  （未束縛・出力時に消えます）」を **warn** で出す。#135 の 4 グループ kpi 超過も、#128 の表紙サブタイトルも、
  **無言 → 警告付き**になる。
- **健全デッキは不変**: 全内容が束縛される健全デッキでは `unbound` が空 → 診断は **1 件も増えない**。同梱
  テンプレの golden・サンプル4種で検証（テストがゲート）。
- **export バイト列は不変**: 段階A は export 経路に一切触れないため、全 golden が byte-identical のまま。
  `resolveBinding.assignments == bindContentByRole` を単体テストで固定（観測ラッパの証明）。
- **判明した既存 silent-drop**: 診断配線により、`Closing.1Message.Single`（ctrTitle 表紙型の closing）に
  body 内容を載せると未束縛で消える等、健全テンプレ上の既存 drop も**観測できる**ようになった。段階A は
  これを warn として可視化するだけで、束縛は変えない（根治は各内容側の split / レイアウト選択で後続）。
- **収束**: 段階 B–E で再計算/再観測サイト（上記 8 箇所）が BindingPlan に集約され、#124 型の「片側だけガード」
  再発が構造的に潰れる。

## References

- [ADR-0011](0011-placeholder-input-bijection.md)（placeholder⇄入力の全単射・ロールバインドを 1 境界に封じる — 本 ADR はその「観測可能な単一プラン」版）
- [ADR-0025](0025-placeholder-role-resolution.md) / [ADR-0029](0029-cover-subtitle-role-recovery.md)（ロール解決・表紙 subtitle リカバリ — 未束縛が出る局面の背景）
- [ADR-0023](0023-third-party-master-idx-convention.md)（第三者マスタの idx 規約 — #128 の着手ゲートの根拠）
- `src/engine/placeholder-binding.ts`（`resolveBinding`/`BindingPlan`/`ContentRef`/`PlaceholderRef`）、`src/engine/group-binding.ts`（`slideBindingPlan`）、`src/engine/deck-diagnostics.ts`（配線）、`src/mcp/session.ts`（`getDiagnostics`）
- `tests/binding-plan.test.ts`（観測ラッパ・全単射・グループ mirror）／`tests/binding-diagnostics.test.ts`（#135/#128 surface・健全不変・byte-identical 証明）
- #145（段階A・本体）／#97（②a surface）／#135（グループ超過 silent-drop）／#128（表紙 subtitle drop）／#144（段階B: serializer）
