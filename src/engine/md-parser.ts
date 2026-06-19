/**
 * md-parser.ts — Parse Markdown into SlideIR[] for PPTX generation.
 *
 * Markdown conventions:
 *   ---                        slide separator (also YAML front matter fence)
 *   <!-- slide: LayoutName --> layout directive
 *   # Heading                  slide title (idx 15) or ctrTitle (idx 0) for title layouts
 *   ## Heading                 subtitle mapped to idx 1 for title layouts
 *   > Blockquote               slide subtitle (idx 16)
 *   <!-- col -->               column separator (idx 1, 2, 3, ...)
 *   <!-- kpi -->               KPI separator (idx 1, 2, ...)
 *   <!-- step -->              process step separator (idx 1, 2, ...)
 *   **bold**  *italic*         inline formatting
 *   - item                     bullet list
 *   Category: / Date: / Footer: / Meta: / Summary:   title slide fields
 *   ```diagram ... ```           embedded diagram (DiagramSpec YAML)
 */

import type {
  DeckIR,
  SlideIR,
  DiagramBlock,
  MermaidBlock,
  PlaceholderContent,
  Paragraph,
  InlineSegment,
} from "./slide-schema";

// ── Title slide field → placeholder idx mapping ──

const TITLE_FIELD_MAP: Record<string, string> = {
  category: "10",
  date: "11",
  footer: "12",
  meta: "11",
  summary: "11",
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

function parseSlideBlock(
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
        mermaidBlock = { mermaid: fig.content, placeholderIdx: colIdx };
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
          mermaidBlock = {
            mermaid: codeBlockLines.join("\n"),
            placeholderIdx: "1",
          };
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
    const fieldMatch = trimmed.match(/^(Category|Date|Footer|Meta|Summary):\s*(.+)/i);
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

  // Body text → idx 1
  const trimmedBody = trimBodyLines(bodyLines);
  if (trimmedBody.length > 0) {
    placeholders.push({
      idx: "1",
      paragraphs: linesToParagraphs(trimmedBody),
    });
  }

  if (placeholders.length === 0 && !diagram && !mermaidBlock) return null;

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
    sourceLineStart: startLine,
    sourceLineEnd: startLine + lines.length - 1,
  };
}

// ── Detect separator type in lines ──

type SeparatorType = "col" | "kpi" | "step";

function detectSeparator(lines: string[]): SeparatorType | null {
  for (const line of lines) {
    const m = line.trim().match(/^<!--\s*(col|kpi|step)\s*-->$/);
    if (m) return m[1] as SeparatorType;
  }
  return null;
}

// ── Split lines by separator comment ──

function splitBySeparator(
  lines: string[],
  sepType: SeparatorType,
): string[][] {
  const pattern = new RegExp(`^<!--\\s*${sepType}\\s*-->$`);
  const sections: string[][] = [];
  let current: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (pattern.test(line.trim())) {
      if (inSection) {
        sections.push(current);
      }
      current = [];
      inSection = true;
    } else if (inSection) {
      current.push(line);
    }
    // Lines before the first separator are skipped (already parsed as title/subtitle)
  }

  if (inSection) {
    sections.push(current);
  }

  return sections;
}

// ── Trim leading/trailing empty lines from body ──

function trimBodyLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

// ── Extract YAML front matter ──

function extractFrontMatter(md: string): {
  frontMatter: Record<string, string>;
  body: string;
} {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { frontMatter: {}, body: md };

  const frontMatter: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) frontMatter[m[1]] = m[2];
  }

  return { frontMatter, body: fmMatch[2] };
}

// ── Main parser ──

export function parseMd(md: string): DeckIR {
  const { frontMatter, body } = extractFrontMatter(md);

  const allLines = body.split("\n");
  const slideBlocks: { lines: string[]; startLine: number }[] = [];

  let currentLines: string[] = [];
  let currentStart = 1; // 1-based line number

  // If front matter was present, offset line numbers
  const lineOffset = md !== body
    ? md.split("\n").indexOf(allLines[0]) + 1
    : 1;

  let inFence = false;
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];

    // Track fenced code blocks so a "---" INSIDE a ```diagram/```mermaid block
    // (a YAML document marker, or Mermaid frontmatter "---\ntitle:…\n---") is NOT
    // mistaken for a slide separator — which would tear the figure in half.
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
    }

    // --- as slide separator (only outside a fenced block)
    if (!inFence && line.trim() === "---") {
      if (currentLines.length > 0) {
        slideBlocks.push({
          lines: currentLines,
          startLine: currentStart,
        });
      }
      currentLines = [];
      currentStart = lineOffset + i + 1;
      continue;
    }

    if (currentLines.length === 0) {
      currentStart = lineOffset + i;
    }
    currentLines.push(line);
  }

  // Don't forget the last block
  if (currentLines.length > 0) {
    slideBlocks.push({ lines: currentLines, startLine: currentStart });
  }

  // Parse each block into a SlideIR
  const slides: SlideIR[] = [];
  for (const block of slideBlocks) {
    const slide = parseSlideBlock(block.lines, block.startLine);
    if (slide) {
      slides.push(slide);
    }
  }

  // If no slides were produced, create a minimal one
  if (slides.length === 0) {
    slides.push({
      layout: "auto",
      placeholders: [],
      sourceLineStart: 1,
    });
  }

  return {
    template: frontMatter.template,
    slides,
  };
}
