/**
 * md-slide-parser.ts — Parse ONE slide block (between `---` separators) into a
 * SlideIR: title/subtitle/fields, columns/KPI/step separators, bullet paragraphs,
 * inline bold/italic runs, and embedded diagram/mermaid figures. Split out
 * of md-parser.ts (R1); md-parser owns front-matter + block-splitting orchestration.
 */
import type { SlideIR, DiagramBlock, MermaidBlock, TableBlock, CodeBlock, ImageBlock, PlaceholderContent, Paragraph, InlineSegment } from "./slide-schema";
import { isSafeImageSrc } from "./slide-schema";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "./mermaid-to-diagram";
import { detectSeparator, splitBySeparator, trimBodyLines } from "./md-separators";
import { findTableInLines, extractBodyTable } from "./md-body-table";
import { isTitleNamespace, metaFieldIdx, TITLE_NS, CONTENT_NS } from "./slide-roles";
import type { ParseNotice } from "./parse-notice";
import { levelFromIndent, measureIndent } from "./paragraph-nesting";

// ── Title slide field → placeholder idx mapping ──

/**
 * A ```mermaid FLOWCHART graduates to the canonical DiagramSpec (editable, native
 * PPTX shapes, one consistent look). Other Mermaid (sequence/class/…) can't yet be
 * modelled, so it stays as a mermaid-image fallback. Keeps a single render path for
 * the common case while nothing breaks for the rest.
 */
function mermaidToFigure(
  mmd: string,
  placeholderIdx: string,
): { diagram?: DiagramBlock; mermaidBlock?: MermaidBlock } {
  const spec = mermaidToDiagramSpec(mmd);
  if (spec) return { diagram: { yaml: diagramSpecToYaml(spec), placeholderIdx } };
  return { mermaidBlock: { mermaid: mmd, placeholderIdx } };
}

// Title-slide metadata (Category/Date/Footer) → idx is defined in slide-roles (metaFieldIdx), the
// single source of truth. (Meta/Summary were previously mapped to "11" too — colliding with Date and
// dropping one — so they're no longer special-cased; "Meta:"/"Summary:" lines fall through to body.)

// ── Inline text parsing ──

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[2]) {
      segments.push({ text: m[2], bold: true });
    } else if (m[3]) {
      segments.push({ text: m[3], italic: true });
    } else if (m[4]) {
      segments.push({ text: m[4] });
    }
  }
  return segments.length > 0 ? segments : [{ text }];
}

// ── Parse lines into paragraphs ──

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
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      // Nesting depth from the ORIGINAL line's leading whitespace (#103) — clamped to
      // MAX_NEST_LEVEL rather than dropped (no-silent-drop), 0 stays field-absent (byte-identical
      // for existing flat decks).
      const level = levelFromIndent(measureIndent(line));
      paragraphs.push({
        segments: parseInline(bulletMatch[1]),
        bullet: true,
        ...(level > 0 ? { level } : {}),
      });
    } else {
      paragraphs.push({ segments: parseInline(trimmed) });
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

// ── Comment-only line stripping (#147) ──

/** A line that is NOTHING but comments — one or more complete `<!-- … -->` units
 *  (optionally whitespace-separated), plus the WHATWG abrupt-close forms `<!-->` /
 *  `<!--->`. All render as nothing in any HTML view. A line with visible text outside
 *  the markers never matches (inline-comment strip = #147 第2弾スコープ). */
const COMMENT_ONLY_RE = /^(?:(?:<!--(?:(?!-->).)*-->|<!--->|<!-->)\s*)+$/;
/** Directive comments that carry meaning — the layout pin, the group separators, the
 *  speaker-note marker (ADR-0032 D1), and the section/toc declarations (ADR-0032 D2).
 *  A payload form (`<!-- note: … -->` etc.) is NOT a directive and stays in the #147
 *  drop class — only the bare markers survive. */
const DIRECTIVE_COMMENT_RE = /^<!--\s*(?:slide:|(?:col|kpi|step|card|note|section|toc)\s*-->$)/;

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

/**
 * #147: Drop non-directive comment-only lines (review notes / TODO markers / source IDs
 * an upstream agent or human left in the Markdown) so they never render onto a slide.
 * A dropped comment also swallows the blank lines directly ABOVE it — the comment
 * "paragraph" disappears whole (`A\n\n<!-- note -->\nB` glues to `A\nB`), while a blank
 * AFTER it still separates content as authored. Fence interiors pass through verbatim
 * (a ``` block keeps comment-looking strings), and directive comments are untouched.
 * Dropped comments do NOT round-trip: the serializer never sees them (spec'd in #147).
 */
function stripCommentOnlyLines(lines: string[]): string[] {
  const out: string[] = [];
  const pendingBlanks: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      out.push(...pendingBlanks.splice(0), line);
    } else if (inFence) {
      out.push(line);
    } else if (t === "") {
      pendingBlanks.push(line);
    } else if (COMMENT_ONLY_RE.test(t) && !DIRECTIVE_COMMENT_RE.test(t)) {
      pendingBlanks.length = 0; // the comment paragraph swallows its leading blanks
    } else {
      out.push(...pendingBlanks.splice(0), line);
    }
  }
  out.push(...pendingBlanks); // trailing blanks (trimBodyLines handles them downstream)
  return out;
}

// ── Parse a single slide block ──

export function parseSlideBlock(
  lines: string[],
  startLine: number,
  notices?: ParseNotice[],
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
  lines = sectionSplit.content;
  const sectionBreak = sectionSplit.sectionBreak;
  let layout = "auto";
  const placeholders: PlaceholderContent[] = [];
  let title: string | undefined;
  let subtitle: string | undefined;
  const bodyLines: string[] = [];
  const titleFields: Record<string, string> = {};
  let diagram: DiagramBlock | undefined;
  let mermaidBlock: MermaidBlock | undefined;
  let code: CodeBlock | undefined;
  let image: ImageBlock | undefined;
  // Declared here (not just in the standard-parse path below) so the separator branch can ALSO
  // bind a column-scoped GFM table (#100) — mirroring how diagram/mermaidBlock are shared.
  let table: TableBlock | undefined;
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
    const groupContent: string[] = [];
    for (const ln of lines.slice(cursor)) {
      const img = matchImageLine(ln.trim());
      if (img && !image) { image = img; continue; }
      groupContent.push(ln);
    }

    // Split remaining content by separator
    const sections = splitBySeparator(groupContent, separatorType);

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
        diagram = { yaml: fig.content, placeholderIdx: colIdx };
      } else if (fig && fig.lang === "mermaid") {
        const f = mermaidToFigure(fig.content, colIdx);
        if (f.diagram) diagram = f.diagram;
        else mermaidBlock = f.mermaidBlock;
      } else {
        const found = findTableInLines(sl);
        if (found) {
          table = { rows: found.rows, header: true, placeholderIdx: colIdx };
        } else {
          const paras = linesToParagraphs(sl, { cellHeading: true });
          if (paras.length > 0) placeholders.push({ idx: colIdx, paragraphs: paras });
        }
      }
    });

    if (placeholders.length === 0 && !diagram && !mermaidBlock && !table && !image && !notes?.length) return null;

    return {
      layout,
      placeholders,
      ...(diagram ? { diagram } : {}),
      ...(mermaidBlock ? { mermaidBlock } : {}),
      ...(table ? { table } : {}),
      ...(image ? { image } : {}), // a 最背面 backdrop can ride a grouped slide too
      ...(notes?.length ? { notes } : {}),
      ...(sectionBreak ? { sectionBreak: true } : {}),
      // The separator KIND is a layout-selection hint (card → card layout, step → process). "col"
      // is plain columns and carries no hint.
      ...(separatorType !== "col" ? { groupKind: separatorType } : {}),
      sourceLineStart: startLine,
      sourceLineEnd: startLine + sourceLen - 1,
    };
  }

  // Standard parsing (no separators)
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  // Commit the current fence's accumulated lines to diagram/mermaid/code. Shared by the closing-fence
  // branch AND the EOF flush (#89) so an UNCLOSED fence's content isn't silently dropped.
  const commitCodeBlock = () => {
    if (codeBlockLang === "diagram" || codeBlockLang === "mermaid-shapes") {
      diagram = { yaml: codeBlockLines.join("\n"), placeholderIdx: "1" };
    } else if (codeBlockLang === "mermaid") {
      const f = mermaidToFigure(codeBlockLines.join("\n"), "1");
      if (f.diagram) diagram = f.diagram;
      else mermaidBlock = f.mermaidBlock;
    } else if (codeBlockLines.length > 0) {
      // Any OTHER fence (```yaml / ```python / ```log / ```) is CODE/LOG — a monospace body.
      code = { content: codeBlockLines.join("\n"), lang: codeBlockLang || undefined, placeholderIdx: "1" };
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

    // Key: Value fields (for title layouts)
    const fieldMatch = trimmed.match(/^(Category|Date|Footer):\s*(.+)/i);
    if (fieldMatch) {
      titleFields[fieldMatch[1].toLowerCase()] = fieldMatch[2];
      continue;
    }

    // ![alt](src) ALONE on a line → an embedded image (data URI or path). Fills body region 1.
    // An optional `{x=…,y=…,w=…,h=…,fit=cover,ar=…,behind=1}` suffix carries geometry/layer attrs (案B).
    // Only the first one becomes the figure; further images fall through to body text.
    const img = matchImageLine(trimmed);
    if (img && !image) {
      image = img;
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
  // a Title/Closing layout OR the presence of any meta field promotes the slide to the title namespace.
  const isTitle = isTitleNamespace(layout, Object.keys(titleFields).length > 0);
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

  // Body: a GFM table becomes a NATIVE table block (fills body region 1 by default); otherwise
  // the body lines become bullet/text paragraphs (idx 1). A single table COEXISTS with any
  // surrounding prose (#101 no-silent-drop, md-body-table.extractBodyTable) — the leftover text
  // is merged into idx "1" the same way plain body text is, appending to an EXISTING idx "1" (a
  // title layout's subtitle) rather than creating a duplicate the serializer would silently drop.
  const trimmedBody = trimBodyLines(bodyLines);
  const { table: foundTable, leftover } = extractBodyTable(trimmedBody, notices);
  if (foundTable) table = foundTable;
  if (leftover.length > 0) {
    const bodyParas = linesToParagraphs(leftover);
    const existing = placeholders.find((p) => p.idx === "1");
    if (existing) existing.paragraphs.push(...bodyParas);
    else placeholders.push({ idx: "1", paragraphs: bodyParas });
  }

  if (placeholders.length === 0 && !diagram && !mermaidBlock && !table && !code && !image && !notes?.length) return null;

  // Diagram/mermaid + body text on one slide → put the visual in the 2nd region
  // (idx 2) so it sits BESIDE the bullets (idx 1) instead of replacing them.
  const hasBodyText = placeholders.some((p) => p.idx === "1");
  if (hasBodyText && diagram) {
    diagram = { ...diagram, placeholderIdx: "2" };
  } else if (hasBodyText && mermaidBlock) {
    mermaidBlock = { ...mermaidBlock, placeholderIdx: "2" };
  }

  return {
    layout,
    placeholders,
    diagram,
    mermaidBlock,
    ...(table ? { table } : {}),
    ...(code ? { code } : {}),
    ...(image ? { image } : {}),
    ...(notes?.length ? { notes } : {}),
    ...(sectionBreak ? { sectionBreak: true } : {}),
    sourceLineStart: startLine,
    sourceLineEnd: startLine + sourceLen - 1,
  };
}

