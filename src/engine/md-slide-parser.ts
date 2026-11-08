/**
 * md-slide-parser.ts — Parse ONE slide block (between `---` separators) into a
 * SlideIR: title/subtitle/fields, columns/KPI/step separators, bullet paragraphs,
 * inline runs (md-inline), and embedded diagram/mermaid figures. Split out
 * of md-parser.ts (R1); md-parser owns front-matter + block-splitting orchestration.
 */
import type { SlideIR, DiagramBlock, MermaidBlock, ImageBlock, PlaceholderContent, Paragraph, FigureBlock } from "./slide-schema";
import { isSafeImageSrc } from "./slide-schema";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "./mermaid-to-diagram";
import { detectSeparator, splitBySeparator, trimBodyLines, matchSeparator } from "./md-separators";
import { findTableInLines, extractBodyTables } from "./md-body-table";
import { figureFields } from "./slide-figures";
import { isTitleNamespace, metaFieldIdx, TITLE_NS, CONTENT_NS, type LayoutRoleLookup } from "./slide-roles";
import type { ParseNotice } from "./parse-notice";
import { levelFromIndent, measureIndent } from "./paragraph-nesting";
import { FIELD_ROWS, matchFieldRow, type FieldKind } from "./field-rows";
import { parseInline } from "./md-inline";
import { matchListItem } from "./list-markers";
import { stripCommentOnlyLines } from "./md-comments";
import { extractSlideMarker, splitQuoteAttribution } from "./slide-markers";

// ── Title slide field → placeholder idx mapping ──

/**
 * A ```mermaid FLOWCHART graduates to the canonical DiagramSpec (editable, native
 * PPTX shapes, one consistent look). Other Mermaid (sequence/class/…) can't yet be
 * modelled, so it stays as a mermaid-image fallback. Keeps a single render path for
 * the common case while nothing breaks for the rest.
 */
function mermaidToFigure(mmd: string, placeholderIdx: string): FigureBlock {
  const spec = mermaidToDiagramSpec(mmd);
  if (spec) return { kind: "diagram", yaml: diagramSpecToYaml(spec), placeholderIdx } satisfies DiagramBlock & { kind: "diagram" };
  return { kind: "mermaid", mermaid: mmd, placeholderIdx } satisfies MermaidBlock & { kind: "mermaid" };
}

// Title-slide metadata (Category/Date/Footer) → idx is defined in slide-roles (metaFieldIdx), the
// single source of truth. (Meta/Summary were previously mapped to "11" too — colliding with Date and
// dropping one — so they're no longer special-cased; "Meta:"/"Summary:" lines fall through to body.)

// ── Parse lines into paragraphs ──

/** Undo the serializer's `\<!-- … -->` escape (#165): a plain line's leading `\<` is the ONLY
 *  backslash form stripped here — no general backslash-escape mechanism (scope kept minimal, per
 *  the issue's confirmed fix). The serializer only ever emits this lead for a comment-only plain
 *  paragraph, so pre-existing visible text is never produced in this shape by round-tripping. */
function unescapeCommentLead(trimmed: string): string {
  return trimmed.startsWith("\\<") ? trimmed.slice(1) : trimmed;
}

function linesToParagraphs(lines: string[], opts?: { cellHeading?: boolean }): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const line of lines) {
    let trimmed = line.trim();
    if (trimmed === "") {
      paragraphs.push({ segments: [{ text: "" }] });
      continue;
    }
    // Blockquote marker → plain body text. Blockquotes consumed as a subtitle
    // are handled upstream; any that reach here would otherwise render the
    // literal '>' onto the slide, so strip the leading marker.
    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      trimmed = quoteMatch[1];
      if (trimmed === "") {
        paragraphs.push({ segments: [{ text: "" }] });
        continue;
      }
    }
    // `### …` → a GROUP heading (card/step) — the group's title line. Inside a group CELL
    // (opts.cellHeading), `## …` gets the same promotion (#102): the #/##/### convention is
    // title/subtitle at the slide's top level, but a cell has no subtitle slot, so a bare `##`
    // there has no valid meaning other than "this cell's heading" and would otherwise print
    // literally. Round-trip is stable because a heading paragraph always serializes as `### `
    // (md-serializer-shared), regardless of which marker it was parsed from.
    const headingMatch = opts?.cellHeading ? trimmed.match(/^#{2,3}\s+(.*)/) : trimmed.match(/^###\s+(.*)/);
    if (headingMatch) {
      paragraphs.push({ segments: parseInline(headingMatch[1] || " "), heading: true });
      continue;
    }
    const item = matchListItem(trimmed); // `-`/`*`, or `1.`/`1)` = ordered (#394, list-markers)
    if (item) {
      // Nesting depth from the ORIGINAL line's leading whitespace (#103) — clamped to
      // MAX_NEST_LEVEL rather than dropped (no-silent-drop), 0 stays field-absent (byte-identical
      // for existing flat decks).
      const level = levelFromIndent(measureIndent(line));
      paragraphs.push({
        segments: parseInline(item.content),
        bullet: true,
        ...(level > 0 ? { level } : {}),
        ...(item.ordered ? { ordered: true } : {}),
      });
    } else {
      paragraphs.push({ segments: parseInline(unescapeCommentLead(trimmed)) });
    }
  }
  return paragraphs;
}

/** First ```lang … ``` fenced block in a set of lines, or null. */
function extractFencedBlock(lines: string[]): { lang: string; content: string } | null {
  let start = -1;
  let lang = "";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (start === -1) {
      if (t.startsWith("```")) {
        start = i;
        lang = t.slice(3).trim().toLowerCase();
      }
    } else if (t.startsWith("```")) {
      return { lang, content: lines.slice(start + 1, i).join("\n") };
    }
  }
  return null;
}

/** Parse an image's `{x=…,y=…,w=…,h=…,fit=cover,ar=…}` attr suffix → geometry override (案B). rect
 *  is set only when all four of x/y/w/h are present (a partial rect is meaningless). Unknown keys are
 *  ignored; malformed numbers are dropped. Inverse of md-serializer.imageAttrs. */
function parseImageAttrs(s: string | undefined): Pick<ImageBlock, "rect" | "fit" | "aspect" | "behind"> {
  if (!s) return {};
  const kv: Record<string, string> = {};
  for (const part of s.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) kv[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  const num = (k: string): number | undefined => {
    const v = Number(kv[k]);
    return kv[k] !== undefined && Number.isFinite(v) ? v : undefined;
  };
  const out: Pick<ImageBlock, "rect" | "fit" | "aspect" | "behind"> = {};
  const [x, y, w, h] = [num("x"), num("y"), num("w"), num("h")];
  if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) out.rect = { x, y, w, h };
  if (kv.fit === "contain" || kv.fit === "cover") out.fit = kv.fit;
  const ar = num("ar");
  if (ar !== undefined && ar > 0) out.aspect = ar;
  if (kv.behind === "1") out.behind = true;
  return out;
}

/** A line that is ONLY `![alt](src){…}` → an image block (with its geometry/behind attrs), else null.
 *  The src is non-greedy so a trailing `{…}` attr suffix isn't swallowed (data URIs contain no `)`). */
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+?)\)(?:\{([^}]*)\})?$/;
function matchImageLine(trimmed: string): ImageBlock | null {
  const m = trimmed.match(IMAGE_LINE_RE);
  // Only a SAFE data:image src becomes an image; an unsafe src (javascript:/remote/relative) returns
  // null → the line falls through to plain text, never a rendered <img> (M6 — see isSafeImageSrc).
  if (!m || !isSafeImageSrc(m[2])) return null;
  return { src: m[2], alt: m[1], placeholderIdx: "1", ...parseImageAttrs(m[3]) };
}

// ── Speaker notes (#150 / ADR-0032 D1) ──

/** The bare `<!-- note -->` marker: everything after it (to the slide's end) is speaker notes. */
const NOTE_MARKER_RE = /^<!--\s*note\s*-->$/;

// ── Section / TOC declarations (#151 / ADR-0032 D2) ──

/** `<!-- section -->` — declares THIS authored slide as a chapter cover (a slide ATTRIBUTE,
 *  not an in-slide separator). `<!-- toc -->` — a block holding ONLY this marker becomes the
 *  derived table-of-contents slide (content re-derived from section-tagged slides). */
const SECTION_MARKER_RE = /^<!--\s*section\s*-->$/;
const TOC_MARKER_RE = /^<!--\s*toc\s*-->$/;

/** Remove fence-external `<!-- section -->` lines, reporting whether any was present. A stray
 *  fence-external `<!-- toc -->` on a slide that has OTHER content is dropped the same way
 *  (#147-consistent: a misplaced marker vanishes rather than rendering as literal text). */
function extractSectionFlag(lines: string[]): { content: string[]; sectionBreak: boolean } {
  let sectionBreak = false;
  let inFence = false;
  const content = lines.filter((ln) => {
    const t = ln.trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      return true;
    }
    if (!inFence && SECTION_MARKER_RE.test(t)) {
      sectionBreak = true;
      return false;
    }
    if (!inFence && TOC_MARKER_RE.test(t)) return false; // toc-only blocks return earlier; here it's stray
    return true;
  });
  return { content, sectionBreak };
}

/** Split a slide block at the first fence-external `<!-- note -->` marker. Fence-aware so a
 *  comment-looking line inside ``` stays code (#147 と同じ理由). Marker absent → notes: null. */
function splitNoteLines(lines: string[]): { content: string[]; notes: string[] | null } {
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("```")) inFence = !inFence;
    else if (!inFence && NOTE_MARKER_RE.test(t)) {
      return { content: lines.slice(0, i), notes: lines.slice(i + 1) };
    }
  }
  return { content: lines, notes: null };
}

// ── Parse a single slide block ──

export function parseSlideBlock(
  lines: string[],
  startLine: number,
  notices?: ParseNotice[],
  catalog?: LayoutRoleLookup,
): SlideIR | null {
  // sourceLineStart/End must span the ORIGINAL block — useDeckRevise slices the raw
  // Markdown by these — so capture the length before comment lines are stripped.
  const sourceLen = lines.length;
  lines = stripCommentOnlyLines(lines);

  // `<!-- toc -->` のみのブロック → 導出専用の派生スライド（内容は消費点で毎回再導出、#151）。
  const nonBlank = lines.map((l) => l.trim()).filter((l) => l !== "");
  if (nonBlank.length === 1 && TOC_MARKER_RE.test(nonBlank[0])) {
    return {
      layout: "auto",
      placeholders: [],
      derived: "toc",
      sourceLineStart: startLine,
      sourceLineEnd: startLine + sourceLen - 1,
    };
  }

  // `<!-- note -->` 以降スライド末尾まではスピーカーノート（本文パースの前に切り離す）。
  const noteSplit = splitNoteLines(lines);
  const notes = noteSplit.notes ? linesToParagraphs(trimBodyLines(noteSplit.notes)) : undefined;
  // `<!-- section -->` は章境界の宣言（スライド属性）— 本文から取り除きフラグ化（#151）。
  const sectionSplit = extractSectionFlag(noteSplit.content);
  // `<!-- statement -->` / `<!-- quote -->` も同じくスライド属性（#593）— 本文から取り除き groupKind へ。
  const markerSplit = extractSlideMarker(sectionSplit.content);
  lines = markerSplit.content;
  const sectionBreak = sectionSplit.sectionBreak;
  let layout = "auto";
  const placeholders: PlaceholderContent[] = [];
  let title: string | undefined;
  let subtitle: string | undefined;
  const bodyLines: string[] = [];
  const titleFields: Record<string, string> = {};
  // #392: every body visual (diagram / mermaid / table / code / non-behind image) with its source
  // position, sorted at the end → `figures` (≥2) + the first-of-kind singular fields (slide-figures).
  // Nothing of the same kind is overwritten any more (the #391/#412 "last wins" drops are gone).
  const visuals: { f: FigureBlock; pos: number }[] = [];
  let image: ImageBlock | undefined; // the slide's FIRST image line (body image or behind backdrop)
  // #397/#398 field rows (`Takeaway:` / `Source:`) → their own canonical content (field-rows.ts), never
  // body. Repeated rows of one kind stack as paragraphs (no silent drop). Namespace-neutral (unlike meta).
  const fieldRows: { kind: FieldKind; value: string }[] = [];
  const pushFieldRows = () => {
    for (const { kind } of FIELD_ROWS) {
      const rows = fieldRows.filter((r) => r.kind === kind);
      if (rows.length) placeholders.push({ idx: kind, paragraphs: rows.map((r) => ({ segments: parseInline(r.value) })) });
    }
  };
  let cursor = 0;

  // Skip leading blank lines — a "---" split leaves one at the top of each block,
  // which would otherwise hide the layout directive and the subtitle blockquote.
  while (cursor < lines.length && lines[cursor].trim() === "") cursor++;

  // Check for layout directive (on the first non-blank line)
  const layoutMatch = lines[cursor]?.match(/^<!--\s*slide:\s*(.+?)\s*-->$/);
  if (layoutMatch) {
    layout = layoutMatch[1];
    cursor++;
  }

  // Check for section separators (col/kpi/step)
  const separatorType = detectSeparator(lines.slice(cursor));

  if (separatorType) {
    // Parse heading first
    for (let i = cursor; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^#\s+/)) {
        title = line.replace(/^#+\s+/, "");
        cursor = i + 1;
        break;
      }
    }

    // Check for subtitle (blockquote after heading), skipping any blank lines.
    while (cursor < lines.length && lines[cursor].trim() === "") cursor++;
    if (cursor < lines.length && lines[cursor].trim().startsWith("> ")) {
      subtitle = lines[cursor].trim().replace(/^>\s*/, "");
      cursor++;
    }

    // A standalone image line (e.g. a 最背面 backdrop) can appear on a GROUPED slide too — pull it out
    // BEFORE section-splitting so it isn't absorbed into the last column's body text (round-trip).
    // Field rows are slide-level, so they're lifted out of the columns the same way (fence-aware: a
    // `source:` key inside a column's ```diagram YAML stays YAML).
    const groupContent: string[] = [];
    let groupFence = false;
    let imagePos = -1; // #392 段 2: the column the body image sat in (source order), -1 = before the 1st
    for (const ln of lines.slice(cursor)) {
      if (ln.trim().startsWith("```")) groupFence = !groupFence;
      const row = groupFence ? null : matchFieldRow(ln.trim());
      if (row) { fieldRows.push(row); continue; }
      const img = matchImageLine(ln.trim());
      if (img && !image) { image = img; imagePos = groupContent.filter((l) => matchSeparator(l)?.type === separatorType).length - 1; continue; }
      groupContent.push(ln);
    }

    // Split remaining content by separator
    const { sections, currentSections, leading } = splitBySeparator(groupContent, separatorType);
    // #451: body before the FIRST separator is dropped (each section starts at its marker) — title/
    // subtitle/field rows/backdrop are already consumed above, so any non-blank line left here is
    // author text that silently vanishes. Only the parser sees these raw lines, hence a notice.
    if (leading.some((l) => l.trim() !== "")) notices?.push({ kind: "pre-separator-dropped", detail: separatorType });

    if (title) {
      placeholders.push({
        idx: "15",
        paragraphs: [{ segments: parseInline(title) }],
      });
    }
    if (subtitle) {
      placeholders.push({
        idx: "16",
        paragraphs: [{ segments: parseInline(subtitle) }],
      });
    }

    sections.forEach((sectionLines, i) => {
      const colIdx = String(i + 1);
      const sl = trimBodyLines(sectionLines); // drop the blank lines around each column
      // A column may be a FIGURE (a ```diagram / ```mermaid block, or a GFM table, #100) instead
      // of text — bind it to THIS column's idx so the figure coexists beside the other columns.
      const fig = extractFencedBlock(sl);
      if (fig && (fig.lang === "diagram" || fig.lang === "mermaid-shapes")) {
        visuals.push({ f: { kind: "diagram", yaml: fig.content, placeholderIdx: colIdx }, pos: i });
      } else if (fig && fig.lang === "mermaid") {
        visuals.push({ f: mermaidToFigure(fig.content, colIdx), pos: i });
      } else {
        const found = findTableInLines(sl);
        if (found) {
          visuals.push({ f: { kind: "table", rows: found.rows, header: true, placeholderIdx: colIdx }, pos: i });
        } else {
          const paras = linesToParagraphs(sl, { cellHeading: true });
          if (paras.length > 0) placeholders.push({ idx: colIdx, paragraphs: paras });
        }
      }
    });
    pushFieldRows();
    // The hoisted image (a body image, not a backdrop) is a visual too — after its column's figure (-1 → -0.5: before the 1st column).
    if (image && !image.behind) visuals.push({ f: { kind: "image", ...image }, pos: imagePos + 0.5 });

    if (placeholders.length === 0 && visuals.length === 0 && !image && !notes?.length) return null;
    const { diagram, mermaidBlock, table, figures } = figureFields(visuals.sort((a, b) => a.pos - b.pos).map((v) => v.f));

    return {
      layout,
      placeholders,
      ...(diagram ? { diagram } : {}),
      ...(mermaidBlock ? { mermaidBlock } : {}),
      ...(table ? { table } : {}),
      ...(image ? { image } : {}), // a 最背面 backdrop can ride a grouped slide too
      ...(figures ? { figures } : {}),
      ...(notes?.length ? { notes } : {}),
      ...(sectionBreak ? { sectionBreak: true } : {}),
      // The separator KIND is a layout-selection hint (card → card layout, step → process). "col"
      // is plain columns and carries no hint.
      // A statement/quote marker on a grouped slide is superseded by the separator kind (contradictory input).
      ...(separatorType !== "col" ? { groupKind: separatorType } : {}),
      ...(currentSections.length ? { currentSteps: currentSections } : {}), // `<!-- step * -->` (#401)
      sourceLineStart: startLine,
      sourceLineEnd: startLine + sourceLen - 1,
    };
  }

  // Standard parsing (no separators). A quote's attribution line (—/―/--, last line) → idx 2 (#593).
  const quote = markerSplit.marker === "quote" ? splitQuoteAttribution(lines) : undefined;
  if (quote) lines = quote.content;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  // Commit the current fence's accumulated lines to diagram/mermaid/code. Shared by the closing-fence
  // branch AND the EOF flush (#89) so an UNCLOSED fence's content isn't silently dropped.
  // Position = between the body lines collected so far (a table starting at that line sorts after it).
  const commitCodeBlock = () => {
    const pos = bodyLines.length - 0.5;
    if (codeBlockLang === "diagram" || codeBlockLang === "mermaid-shapes") {
      visuals.push({ f: { kind: "diagram", yaml: codeBlockLines.join("\n"), placeholderIdx: "1" }, pos });
    } else if (codeBlockLang === "mermaid") {
      visuals.push({ f: mermaidToFigure(codeBlockLines.join("\n"), "1"), pos });
    } else if (codeBlockLines.length > 0) {
      // Any OTHER fence (```yaml / ```python / ```log / ```) is CODE/LOG — a monospace body.
      visuals.push({ f: { kind: "code", content: codeBlockLines.join("\n"), lang: codeBlockLang || undefined, placeholderIdx: "1" }, pos });
    }
  };

  for (let i = cursor; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ``` fenced code block detection
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim().toLowerCase();
        codeBlockLines = [];
        continue;
      } else {
        // End of code block — commit it (diagram / mermaid / code).
        commitCodeBlock();
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockLines = [];
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // # Heading → title
    if (trimmed.match(/^#\s+/) && !title) {
      title = trimmed.replace(/^#+\s+/, "");
      continue;
    }

    // ## Heading → subtitle (for title layouts) or treated as subtitle
    if (trimmed.match(/^##\s+/) && !subtitle) {
      subtitle = trimmed.replace(/^#+\s+/, "");
      continue;
    }

    // > Blockquote → subtitle (after the title, before any real body content).
    // Allow leading blank lines (e.g. the blank a "---" split leaves at the top of
    // a block) — otherwise the subtitle leaks into the body.
    if (
      trimmed.startsWith("> ") &&
      title &&
      !subtitle &&
      bodyLines.every((l) => l.trim() === "")
    ) {
      subtitle = trimmed.replace(/^>\s*/, "");
      continue;
    }

    const row = matchFieldRow(trimmed);
    if (row) {
      fieldRows.push(row);
      continue;
    }

    // Key: Value fields (for title layouts)
    const fieldMatch = trimmed.match(/^(Category|Date|Footer):\s*(.+)/i);
    if (fieldMatch) {
      titleFields[fieldMatch[1].toLowerCase()] = fieldMatch[2];
      continue;
    }

    // ![alt](src) ALONE on a line → an embedded image (data URI or path). Fills body region 1.
    // An optional `{x=…,y=…,w=…,h=…,fit=cover,ar=…,behind=1}` suffix carries geometry/layer attrs (案B).
    // The first image line becomes the image (body or behind); #392: further BODY images join the
    // visuals when the first was a body image too. Any other image line falls through to body text.
    const img = matchImageLine(trimmed);
    if (img && (!image || (!image.behind && !img.behind))) {
      image ??= img;
      if (!img.behind) visuals.push({ f: { kind: "image", ...img }, pos: bodyLines.length - 0.5 });
      continue;
    }

    // Everything else → body
    bodyLines.push(line);
  }

  // #89 no-silent-drop: an UNCLOSED diagram/mermaid/code fence (e.g. from the docs nested-fence copy
  // bug #88, where the inner closing ``` was consumed by the outer markdown fence) leaves inCodeBlock
  // true here. Commit it as if the fence closed at slide end, rather than dropping the lines silently.
  if (inCodeBlock) commitCodeBlock();

  // Determine the placeholder namespace (title vs content) — the SINGLE shared rule (slide-roles):
  // a Title/Closing layout OR the presence of any meta field promotes the slide to the title
  // namespace; with a catalog, so does a pin whose resolved layout ROLE is title/closing (#453).
  const isTitle = isTitleNamespace(layout, Object.keys(titleFields).length > 0, catalog);
  const ns = isTitle ? TITLE_NS : CONTENT_NS;

  // Build placeholders: # → title idx, ## / > → subtitle idx (namespace-dependent).
  if (title) placeholders.push({ idx: ns.title, paragraphs: [{ segments: parseInline(title) }] });
  if (subtitle) placeholders.push({ idx: ns.subtitle, paragraphs: [{ segments: parseInline(subtitle) }] });
  if (isTitle) {
    // Title-slide metadata (Category/Date/Footer) → its canonical meta idx.
    for (const [field, value] of Object.entries(titleFields)) {
      const idx = metaFieldIdx(field);
      if (idx) placeholders.push({ idx, paragraphs: [{ segments: parseInline(value) }] });
    }
  }
  pushFieldRows();

  // Body: a GFM table becomes a NATIVE table block (fills body region 1 by default); otherwise
  // the body lines become bullet/text paragraphs (idx 1). A single table COEXISTS with any
  // surrounding prose (#101 no-silent-drop, md-body-table.extractBodyTable) — the leftover text
  // is merged into idx "1" the same way plain body text is, appending to an EXISTING idx "1" (a
  // title layout's subtitle) rather than creating a duplicate the serializer would silently drop.
  const trimmedBody = trimBodyLines(bodyLines);
  const { tables, leftover } = extractBodyTables(trimmedBody);
  const lead = bodyLines.findIndex((l) => l.trim() !== ""); // trimBodyLines' offset into bodyLines
  for (const t of tables) visuals.push({ f: { kind: "table", ...t.table }, pos: lead + t.start });
  if (leftover.length > 0) {
    const bodyParas = linesToParagraphs(leftover);
    const existing = placeholders.find((p) => p.idx === "1");
    if (existing) existing.paragraphs.push(...bodyParas);
    else placeholders.push({ idx: "1", paragraphs: bodyParas });
  }
  if (quote?.attribution) placeholders.push({ idx: "2", paragraphs: [{ segments: parseInline(quote.attribution) }] });

  if (placeholders.length === 0 && visuals.length === 0 && !image && !notes?.length) return null;

  // Diagram/mermaid + body text on one slide → put the visual in the 2nd region
  // (idx 2) so it sits BESIDE the bullets (idx 1) instead of replacing them.
  // #390: a table / code block beside body text gets the same treatment — at idx 1 it would share the
  // bullets' region, where export skips (table) or overwrites (code) the text silently. Content
  // namespace only: in the title namespace idx 1 is the SUBTITLE, not a body region to sit beside.
  // #392: applied to EVERY visual of the kind, so the singular field and `figures` agree.
  const hasBodyText = placeholders.some((p) => p.idx === "1");
  const shift = (f: FigureBlock): FigureBlock =>
    hasBodyText && (f.kind === "diagram" || f.kind === "mermaid" || (!isTitle && (f.kind === "table" || f.kind === "code")))
      ? { ...f, placeholderIdx: "2" }
      : f;
  const ff = figureFields(visuals.sort((a, b) => a.pos - b.pos).map((v) => shift(v.f)));

  return {
    layout,
    placeholders,
    diagram: ff.diagram,
    mermaidBlock: ff.mermaidBlock,
    ...(ff.table ? { table: ff.table } : {}),
    ...(ff.code ? { code: ff.code } : {}),
    ...(image ? { image } : {}),
    ...(ff.figures ? { figures: ff.figures } : {}),
    ...(notes?.length ? { notes } : {}),
    ...(sectionBreak ? { sectionBreak: true } : {}),
    ...(markerSplit.marker ? { groupKind: markerSplit.marker } : {}),
    sourceLineStart: startLine,
    sourceLineEnd: startLine + sourceLen - 1,
  };
}

