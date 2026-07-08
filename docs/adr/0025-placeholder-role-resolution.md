# ADR-0025: Placeholder のロール解決 — 明示ラダー＋gate 付き title リカバリ

- Status: Accepted
- Date: 2026-07-08
- Supersedes: なし（[ADR-0011](0011-placeholder-input-bijection.md) / [ADR-0023](0023-third-party-master-idx-convention.md) を補完）

## Context

SlideCraft はコンテンツ（`# 見出し`＝title, 箇条書き＝body …）をレイアウトの placeholder に **ロールで**束縛する（idx 直値ではない）。ロールは単一関数 `placeholderRole(ph)` が決め、これを **binding・catalog・`contentIdxForPlaceholder`・`buildFieldMap`** が共有する（＝ ADR-0011 の全単射の要）。

`placeholderRole` の実質的な優先順位（暗黙のラダー）:

1. **明示 PPTX type**（`title`/`ctrTitle`・`body`・`ftr`/`dt`/`sldNum`/`pic`/`chart`/`tbl`）— 絶対
2. **canonical idx-meta 規約**（15→title, 16→subtitle, 10/11/12→category/date/footer, 50→slideNumber）— 自前マスタが opt-in の時のみ
3. **`type="body"` / idx 1–9** → body — 絶対
4. **リカバリ（geometry → name → area）** — **type が空 かつ idx が非規約** の時だけ到達

問題: **type が絶対**なので、`type="body"`（または body idx）で **名前が "Title"/"タイトル"・idx=0・位置が上部** の placeholder は body 判定になり、name も geometry も一切参照されない。結果その layout に title ロールの箱が無くなり、デッキの title は**受け皿が無く未バインド＝画面に出ない**。一方その箱には body が流れる。

実測（再現テスト）:

| name | type | idx | 現状判定 |
| --- | --- | --- | --- |
| Title | `body` | 0 | **body**（誤） |
| Title | `""` | 0 | title（正） |
| Title | `title` | 0 | title（正） |
| Title | `body` | 0（title 形状の geometry 付き） | **body**（誤・geometry も無視される） |

title は「レイアウト上の重要属性」であり、**あらゆる手段で特定できるべき**。ただし name は束縛のノイズになりやすい（body 箱がたまたま "Title Text" 等）ため、単純に name を上位に上げるのは危険。

## Decision

ロール解決を **2 フェーズ**に整理する。「つけたし」ではなく、優先順位と gate を明文化した単一方針とする。

### Phase 1 — per-placeholder base role（現状維持）

上記ラダー 1–4 をそのまま base role とする。**健全テンプレは byte-identical**（変更なし）。

### Phase 2 — layout 単位の gated title リカバリ（新規・取込時に確定）

レイアウトの base role を出したうえで、**その layout に title ロールが1つも無い時だけ**、title 候補を昇格する。判定は **合議（consensus）**:

```
promote (role := title) IF
   layout に role=="title" が皆無                    ← gate（本物の title は絶対に奪わない）
   AND ph の base role が body / other               ← 非meta のみ（date/footer/subtitle 等は不可侵）
   AND nameRole(ph.name) == "title"                  ← 名前が title 系（subtitle は nameRole が除外）
   AND ( ph.idx == "0"  OR  geometryRole(ph.style)=="title" )  ← idx0（PowerPoint の title スロット）or 上部・横長・低
候補が複数なら score = 2*(idx0) + 1*(geometry) の最大を採用
```

- **確定は template-loader の取込時**（`metaIdxConvention` stamp 直後）に行い、勝者 placeholder に `resolvedRole="title"` を刻む。`placeholderRole` は `resolvedRole` があれば最優先で返す。→ **binding / catalog / fieldMap すべてが同一ロールを見る**＝ ADR-0011 の全単射を維持。
- **idx=0 を title シグナルに格上げ**（従来は `type="title"` に暗黙依存していただけ）。

## Consequences

- **修正**: body 型・idx0 の "Title" placeholder が title を受け取る（本 issue の解消）。
- **健全テンプレ不変**: gate（title 不在時のみ）により、title 型を持つ canonical/一般テンプレでは発火しない → 束縛・golden は byte-identical。
- **全単射維持**: ロールを取込時に1回だけ確定し全 consumer が共有。
- **誤昇格の抑制**: 「name 必須 ＋ (idx0 or geometry) ＋ 非meta ＋ title 不在」の合議 gate で、body 箱の巻き込みを最小化。
- **スコープ**: 今回は **title のみ**。subtitle/body の同種リカバリは必要が出たら別途（YAGNI）。
- **リスク/限界**: 「name も idx0 も geometry も title らしくない、真に型崩れした title」は依然拾えない（＝ Re-make 経路の対象・[ADR-0023](0023-third-party-master-idx-convention.md)）。合議を緩める余地はあるが、まず安全側で確定。

## References

- [ADR-0011](0011-placeholder-input-bijection.md)（placeholder⇄入力の全単射・単一ロール関数）
- [ADR-0023](0023-third-party-master-idx-convention.md)（第三者マスタの idx 規約 gate・Re-make）
- `src/engine/template-catalog.ts` `placeholderRole` / `recoverLayoutTitle`、`src/engine/template-loader.ts`（取込時 stamp）
