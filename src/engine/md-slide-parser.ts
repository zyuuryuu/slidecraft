/**
 * md-slide-parser.ts — Parse ONE slide block (between `---` separators) into a
 * SlideIR: title/subtitle/fields, columns/KPI/step separators, bullet paragraphs,
 * inline bold/italic runs, and embedded diagram/mermaid figures. Split out
 * of md-parser.ts (R1); md-parser owns front-matter + block-splitting orchestration.
 */
import type { SlideIR, DiagramBlock, MermaidBlock, TableBlock, PlaceholderContent, Paragraph, InlineSegment } from "./slide-schema";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "./mermaid-to-diagram";
import { detectSeparator, splitBySeparator, trimBodyLines } from "./md-separators";
import { isTableRow, parseMarkdownTable } from "./md-table";

/** Find the first GFM table anywhere in `lines` (a `| … |` row + a `|---|` line). */
function findTableInLines(lines: string[]): string[][] | null {
  for (let i = 0; i + 1 < lines.length; i++) {
    if (isTableRow(lines[i])) {
      const parsed = parseMarkdownTable(lines.slice(i));
      if (parsed) return parsed.rows;
    }
  }
  return null;
}

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

// Real title-slide metadata regions in the master. (Meta/Summary were previously
// mapped to "11" too — colliding with Date and dropping one — so they're no longer
// special-cased; "Meta:"/"Summary:" lines fall through to body text and survive.)
const TITLE_FIELD_MAP: Record<string, string> = {
  category: "10",
  date: "11",
  footer: "12",
};

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

function linesToParagraphs(lines: string[]): Paragraph[] {
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
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      paragraphs.push({
        segments: parseInline(bulletMatch[1]),
        bullet: true,
      });
    } else {
      paragraphs.push({ segments: parseInline(trimmed) });
    }
  }
  return paragraphs;
}

// ── Check if layout is a title layout ──

function isTitleLayout(layout: string): boolean {
  return layout.startsWith("Title.") || layout.startsWith("Closing.");
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

// ── Parse a single slide block ──

export function parseSlideBlock(
  lines: string[],
  startLine: number,
): SlideIR | null {
  let layout = "auto";
  const placeholders: PlaceholderContent[] = [];
  let title: string | undefined;
  let subtitle: string | undefined;
  const bodyLines: string[] = [];
  const titleFields: Record<string, string> = {};
  let diagram: DiagramBlock | undefined;
  let mermaidBlock: MermaidBlock | undefined;
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

    // Split remaining content by separator
    const sections = splitBySeparator(lines.slice(cursor), separatorType);

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
      // A column may be a FIGURE (a ```diagram / ```mermaid block) instead of text —
      // bind it to THIS column's idx so the figure coexists beside the other columns.
      const fig = extractFencedBlock(sl);
      if (fig && (fig.lang === "diagram" || fig.lang === "mermaid-shapes")) {
        diagram = { yaml: fig.content, placeholderIdx: colIdx };
      } else if (fig && fig.lang === "mermaid") {
        const f = mermaidToFigure(fig.content, colIdx);
        if (f.diagram) diagram = f.diagram;
        else mermaidBlock = f.mermaidBlock;
      } else {
        const paras = linesToParagraphs(sl);
        if (paras.length > 0) placeholders.push({ idx: colIdx, paragraphs: paras });
      }
    });

    if (placeholders.length === 0 && !diagram && !mermaidBlock) return null;

    return {
      layout,
      placeholders,
      ...(diagram ? { diagram } : {}),
      ...(mermaidBlock ? { mermaidBlock } : {}),
      sourceLineStart: startLine,
      sourceLineEnd: startLine + lines.length - 1,
    };
  }

  // Standard parsing (no separators)
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

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
        // End of code block
        if (codeBlockLang === "diagram" || codeBlockLang === "mermaid-shapes") {
          diagram = {
            yaml: codeBlockLines.join("\n"),
            placeholderIdx: "1",
          };
        } else if (codeBlockLang === "mermaid") {
          const f = mermaidToFigure(codeBlockLines.join("\n"), "1");
          if (f.diagram) diagram = f.diagram;
          else mermaidBlock = f.mermaidBlock;
        }
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

    // Everything else → body
    bodyLines.push(line);
  }

  // Determine if this is a title layout
  const isTitle = isTitleLayout(layout) || Object.keys(titleFields).length > 0;

  // Build placeholders
  if (isTitle) {
    // Title layouts: # → idx 0 (ctrTitle), ## → idx 1 (subTitle)
    if (title) {
      placeholders.push({
        idx: "0",
        paragraphs: [{ segments: parseInline(title) }],
      });
    }
    if (subtitle) {
      placeholders.push({
        idx: "1",
        paragraphs: [{ segments: parseInline(subtitle) }],
      });
    }
    for (const [field, value] of Object.entries(titleFields)) {
      const idx = TITLE_FIELD_MAP[field];
      if (idx) {
        placeholders.push({
          idx,
          paragraphs: [{ segments: parseInline(value) }],
        });
      }
    }
  } else {
    // Content layouts: # → idx 15 (title), > → idx 16 (subtitle)
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
  }

  // Body: a GFM table becomes a NATIVE table block (fills body region 1); otherwise
  // the body lines become bullet/text paragraphs (idx 1).
  const trimmedBody = trimBodyLines(bodyLines);
  let table: TableBlock | undefined;
  const tableRows = findTableInLines(trimmedBody);
  if (tableRows) {
    table = { rows: tableRows, header: true, placeholderIdx: "1" };
  } else if (trimmedBody.length > 0) {
    // Merge into an EXISTING idx "1" (a title layout's subtitle) rather than create a
    // DUPLICATE idx "1": the serializer reads only the first idx-1 placeholder, so a
    // duplicate silently drops the body on round-trip. Content layouts put the subtitle
    // at idx 16, so there's no idx-1 yet and the body becomes its own placeholder.
    const bodyParas = linesToParagraphs(trimmedBody);
    const existing = placeholders.find((p) => p.idx === "1");
    if (existing) existing.paragraphs.push(...bodyParas);
    else placeholders.push({ idx: "1", paragraphs: bodyParas });
  }

  if (placeholders.length === 0 && !diagram && !mermaidBlock && !table) return null;

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
    sourceLineStart: startLine,
    sourceLineEnd: startLine + lines.length - 1,
  };
}

