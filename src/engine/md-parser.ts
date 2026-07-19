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

import type { DeckIR, SlideIR } from "./slide-schema";
import { parseSlideBlock } from "./md-slide-parser";

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

export function parseMd(rawMd: string): DeckIR {
  // Windows 由来の CRLF は行数を変えずに正規化する（sourceLine 計算は行数に依存するため影響なし）。
  // これにより front matter / layout directive の raw 行照合（`\n$` 前提の正規表現）が LF と同様に効く（#164）。
  const md = rawMd.replace(/\r\n/g, "\n");
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
