# Markdown Authoring Guide

SlideCraft splits the Markdown you provide into "one-slide-at-a-time" blocks, interprets each block as a structure of title, body, figures, and so on, and then flows it into your template's colors, fonts, and layouts. This page gives a comprehensive overview of the Markdown notation for building slides.

Placement and styling are delegated to the template and the engine, so you can produce polished slides without shrinking font sizes by hand or micro-specifying coordinates. Only the notation for figures (diagrams) is extensive, so it lives in its own page: [Diagrams](/en/guide/diagrams).

::: tip Prerequisite
If you haven't installed the app yet, start with [Installation](/en/guide/installation). SlideCraft's philosophy (write → see → export) is also touched on at the top of each page.
:::

---

## Slide separator `---`

A line that is nothing but `---` (a horizontal rule) marks **the boundary of a single slide**. One slide is generated for each separator.

```markdown
# 最初のスライド

- ポイント1
- ポイント2

---

# 次のスライド

本文テキスト。
```

The example above produces two slides. The separator is a line whose beginning is `---` and nothing else. A GFM table's delimiter row (`|---|---|`) carries the leading pipe of a cell, so it is never confused with a slide separator.

::: tip
A leading blank line is fine. The parser skips over any leading blank line that a separator leaves behind.
:::

---

## Title, subtitle, and body

Within a single slide, the role of each line is determined by its heading level and line type.

| Notation | Role |
|---|---|
| `# 見出し` | The slide's **title** |
| `## 見出し` or `> 引用` | **Subtitle** |
| `- ` / `* ` bullets, paragraphs | **Body** |
| `### 見出し` | A **subheading** inside a group (column/card/step) |
| `**太字**` / `*斜体*` | Inline styling |

```markdown
# 2026年 事業計画
> 第2四半期レビュー

- 売上は前年比 **+12%**
- 新規顧客は *120 社*
```

A few behaviors are worth keeping in mind.

- Only the first `#` becomes the title. Any `#` lines beyond the first are treated as body.
- The subtitle can be specified with either `##` or `>` (a blockquote). However, `>` only becomes a subtitle when placed **immediately after the title and before the body begins**. A `>` that appears after the body has begun becomes an ordinary body line with the quote marker stripped.
- Only one subtitle is picked up, too.

::: warning A common mix-up
If you put a `>` line in the middle of the body, it is displayed as "body with the `>` stripped," not as a blockquote. Note that SlideCraft's Markdown is not a general-purpose Markdown viewer but a converter into slide structure.
:::

---

## Meta information `Category:` / `Date:` / `Footer:`

On title slides, lines beginning with `Category:` / `Date:` / `Footer:` are treated as **meta information** and flowed into the template's corresponding frames (category, date, footer).

```markdown
# 2026年 事業計画
> 第2四半期レビュー

Category: 経営会議
Date: 2026-07-07
Footer: 社外秘
```

Points to remember:

- There are only three keys: `Category` / `Date` / `Footer` (case-insensitive). If any one of the three is present, that slide is treated as a title-type slide (a layout with meta frames is more likely to be chosen).
- Other keys such as `Meta:` or `Summary:` are **not treated as meta and become body lines**. Only the three above are treated specially.
- When you want to use a specific layout rather than leaving it to automatic selection, write `<!-- slide: レイアウト名 -->` on the first line of the block. Normally you can omit this and leave it to automatic selection (`auto`).

```markdown
<!-- slide: title-centered -->
# 表紙タイトル
```

---

## GFM tables

A standard GFM (GitHub Flavored Markdown) table becomes a **native PPTX table** (cells editable in PowerPoint), not an image. It enters the body area as a table with a header row.

```markdown
# 比較表

| 項目 | 旧プラン | 新プラン |
|------|---------|---------|
| 料金 | ¥1,000  | ¥800    |
| 容量 | 10 GB   | 30 GB   |
```

- A table is recognized as the pair of a `| … |` row and the delimiter row that immediately follows it (`|---|---|`).
- Wherever it appears in the body, only the first table becomes a native table.
- Because the table is not rasterized, you can edit its cells directly in the resulting PPTX.

---

## Images `![alt](data:image...)`

Writing `![alt](src)` alone on a line makes it an embedded image.

::: warning Data URIs only
Only a **data URI (`data:image/...;base64,...`)** becomes an embedded image. For safety, a src that is a remote URL, a local path, `javascript:`, and the like is not turned into an image, and that line is treated as plain body text. Convert to a data URI before pasting it in.
:::

```markdown
# ロゴ

![会社ロゴ](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...)
```

Images are automatically included in the preview and the HTML output, and in the PPTX they are decoded and embedded as media. On a single slide, only the first image is picked up as an image; any image line beyond that falls back to body text.

### Position, size, and crop attributes `{...}`

Appending `{...}` to the end of an image line lets you finely specify position, size, crop, and layer. Attributes are comma-separated `key=value` pairs.

```markdown
![背景](data:image/png;base64,...){x=0,y=0,w=13.33,h=7.5,fit=cover,behind=1}
```

| Key | Meaning | Value |
|---|---|---|
| `x` `y` | Top-left position (inches) | Number |
| `w` `h` | Width / height (inches) | Number |
| `fit` | How to fit into the frame | `cover` (crop to fill) / `contain` (fit the whole) |
| `ar` | The source image's aspect ratio (w/h) | Positive number |
| `behind` | Lay it on the backmost layer | `1` |

Points to remember:

- The coordinate system is in inches on a **13.33 × 7.5 inch slide** (`x=0,y=0` is top-left; `w=13.33,h=7.5` covers the full slide).
- `x` `y` `w` `h` take effect as a position specification **only when all four are present**. If you write only some of them, they are ignored and the image fills its allotted frame.
- An `![alt](src)` with attributes omitted takes the default size that fills its allotted body frame.
- You can **drag to move and resize in the visual editor**, and the result is saved back into the Markdown as these `{...}` attributes (a round trip). Rather than writing by hand, it's easier to place first and then export.
- `behind=1` lays the image on the backmost layer. This suits placing body text over a background photo or watermark pattern.

::: details Background images work on column-split slides too
Even on a slide split with `<!-- col -->` and the like, a standalone image line (especially a `behind=1` background) is not taken into each column's body but is treated as the background of the whole slide.
:::

---

## Multi-column / KPI / Steps / Cards

When you want to split a slide's body into **multiple regions**, use separator comments. Place separator comments of the same kind after `# タイトル` and write the content of each region between them.

| Separator comment | Purpose |
|---|---|
| `<!-- col -->` | Multiple side-by-side columns |
| `<!-- kpi -->` | KPI (big-number) tiles |
| `<!-- step -->` | Process / procedure steps |
| `<!-- card -->` | Cards |

```markdown
# 3本柱

<!-- col -->
### 品質
- 不良率を半減

<!-- col -->
### 速度
- リードタイム短縮

<!-- col -->
### コスト
- 原価 10% 削減
```

Usage notes:

- A separator comment must be **on a line of its own** (do not write body before or after it, as in `<!-- col -->`).
- Content written **before** the first separator comment does not go into any region, apart from the title/subtitle. The title (`#`) and subtitle (`>`) become the heading for the whole slide, and each region's content is written **between** the separators.
- In each region, `### 小見出し` becomes the region's header, and bullets or paragraphs go beneath it.
- Aside from `col` (a plain column), `kpi` / `step` / `card` act as hints to choose the corresponding layout (KPI tiles, process, cards). `col` is a plain side-by-side layout with no hint.

### Placing a figure in a region

Each region can hold a **figure** instead of body text. Writing a ` ```diagram ` or ` ```mermaid ` fence inside a region turns that region into a figure, which sits side by side with the other columns.

```markdown
# 構成と指標

<!-- col -->
### 構成
```diagram
type: pie
nodes:
  - { id: a, label: 国内, value: 60 }
  - { id: b, label: 海外, value: 40 }
```

<!-- col -->
### 指標
- 稼働率 98%
- 月次成長 +12%
```

For the figure notation itself, see [Diagrams](/en/guide/diagrams).

---

## Code fences

A fenced block enclosed in ` ``` ` is handled differently depending on the **fence's language name**.

| Fence | Handling |
|---|---|
| ` ```diagram ` | Draw a native figure from a DiagramSpec (YAML/JSON) → [Diagrams](/en/guide/diagrams) |
| ` ```mermaid ` | Mermaid notation. Convertible ones become native figures; the rest fall back to a Mermaid image |
| Others (` ```yaml ` / ` ```python ` / a bare ` ``` ` with no language, etc.) | Displayed as monospace **code / log** |

```markdown
# 設定例

```yaml
server:
  port: 8080
  workers: 4
```
```

Fences not used for figures (`yaml` / `python` / `bash` / `log`, no language specified, and so on) are placed on the slide as-is as a monospace code block. The language name is preserved as a display hint.

::: warning Mermaid that can't be converted to a figure
Mermaid's `gitGraph` / `sankey` / `C4` and the like cannot be converted to native figures and **cannot be output to PPTX either**. By default they are rejected at export time, and they never disappear silently. Replace them with a supported figure (the 12 types in [Diagrams](/en/guide/diagrams), or convertible Mermaid). For details, see the [FAQ](/en/guide/faq).
:::

---

## When the body overflows

When the body doesn't fit on a slide, the engine **splits the overflow deterministically** and distributes the content across multiple slides. It will not force-shrink the font to cram everything onto one slide. Long bullet lists can be made more readable by summarizing the content or organizing it into a GFM table. The built-in AI can help with summarizing, too ([AI Setup](/en/guide/ai-setup)).

---

## Related pages

- [Diagrams](/en/guide/diagrams) — 12 native types drawable with `diagram` / `mermaid` fences, plus 4 more via Mermaid
- [Templates](/en/guide/templates) — the source of the look (color scheme, fonts, layouts)
- [AI Setup](/en/guide/ai-setup) — the built-in offline AI for generation and editing
- [MCP](/en/guide/mcp) — integration from an upstream AI agent
- [FAQ](/en/guide/faq) — fixes for images becoming body, figures not appearing, and more
