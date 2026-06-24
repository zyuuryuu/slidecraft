/**
 * manuscript.ts — Turn a RAW manuscript (prose Markdown with #/## headings and no
 * slide structure) into slide-structured SlideCraft Markdown, DETERMINISTICALLY:
 * each heading section becomes a slide (heading → title, prose → bullets, lists/
 * tables/code preserved). The normal parse + distill pipeline then fits it to the
 * template. This is the "split a script into slides" half of the last-mile harness
 * — no model needed for the structuring; condensing/visualizing are later levers.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

interface Section {
  level: number; // heading level (0 = preamble before any heading)
  heading: string;
  lines: string[];
}

/** Already slide-structured? A `<!-- slide: -->` directive, or 2+ `---` separator
 *  lines (a deck) vs a manuscript's lone horizontal rule → leave it untouched. */
export function isSlideStructured(md: string): boolean {
  if (/<!--\s*slide:/i.test(md)) return true;
  return (md.match(/^---\s*$/gm) ?? []).length >= 2;
}

function splitSections(md: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inFence = false;
  for (const line of md.split("\n")) {
    if (line.trim().startsWith("```")) inFence = !inFence;
    const h = inFence ? null : line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      if (cur) sections.push(cur);
      cur = { level: h[1].length, heading: h[2].trim(), lines: [] };
    } else {
      if (!cur) cur = { level: 0, heading: "", lines: [] };
      cur.lines.push(line);
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

/** Split a prose paragraph into short bullet phrases at sentence boundaries. */
function proseToBullets(text: string): string[] {
  return text
    .split(/(?<=[。．！？!?])\s*/)
    .map((s) => s.trim().replace(/[。．.]+\s*$/, ""))
    .filter((s) => s.length > 0);
}

/** A section's body lines → slide body Markdown: prose→bullets; lists/tables/code kept. */
function sectionBody(lines: string[]): string {
  const out: string[] = [];
  let inFence = false;
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      for (const b of proseToBullets(para.join(" ").trim())) out.push(`- ${b}`);
      para = [];
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("```")) { flush(); inFence = !inFence; out.push(line); continue; }
    if (inFence) { out.push(line); continue; }
    if (t === "") { flush(); continue; }
    if (/^[-*+]\s+/.test(t)) { flush(); out.push(`- ${t.replace(/^[-*+]\s+/, "")}`); continue; } // existing bullet
    if (t.startsWith("|")) { flush(); out.push(line); continue; } // table row — keep verbatim
    if (t.startsWith(">")) { flush(); out.push(`- ${t.replace(/^>\s*/, "")}`); continue; } // blockquote → bullet
    // A standalone "ラベル: 値" spec line (no trailing sentence punctuation) is its OWN
    // bullet — otherwise consecutive spec lines (no blank between, no 。) merge into one
    // run-on bullet and the key-value → table lever never fires.
    if (/^[^:：\n]{1,24}[:：]\s*\S/.test(t) && !/[。．！？!?]$/.test(t)) { flush(); out.push(`- ${t}`); continue; }
    para.push(t);
  }
  flush();
  return out.join("\n");
}

/**
 * VISUALIZE (low-interference): if a section's body is ENTIRELY "ラベル: 値" bullets
 * (a spec / key-value list), present it as a 2-column GFM table (→ native table)
 * instead of bullets. Returns null unless every bullet is a clean key-value pair.
 * Words are never reworded — only the form changes.
 */
export function keyValueTable(bodyMd: string): string | null {
  const lines = bodyMd.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const pairs: Array<[string, string]> = [];
  for (const l of lines) {
    const m = l.match(/^-\s+([^:：]+?)\s*[:：]\s*(.+)$/); // "- ラベル: 値"
    if (!m) return null; // not all key-value → keep bullets
    pairs.push([m[1].trim(), m[2].trim()]);
  }
  const esc = (c: string) => c.replace(/\|/g, "\\|");
  const rows = pairs.map(([k, v]) => `| ${esc(k)} | ${esc(v)} |`);
  return ["| 項目 | 内容 |", "| --- | --- |", ...rows].join("\n");
}

/**
 * Structure a raw manuscript into slide Markdown. The first H1 becomes a Title
 * slide; every other heading becomes a content slide. Returns the input unchanged
 * when it's already slide-structured or has no headings (nothing to structure).
 */
export function structureManuscript(md: string): string {
  const src = md.trim();
  if (!src || isSlideStructured(src)) return src;

  const sections = splitSections(src).filter((s) => s.heading || s.lines.some((l) => l.trim()));
  if (sections.every((s) => s.level === 0)) return src; // no headings → nothing to split on

  const slides: string[] = [];
  let titleDone = false;
  for (const sec of sections) {
    if (sec.level === 0) {
      // preamble prose before the first heading → a lead-in content slide
      const body = sectionBody(sec.lines);
      if (body) slides.push(`# 概要\n\n${body}`);
      continue;
    }
    if (!titleDone && sec.level === 1) {
      slides.push(`<!-- slide: Title.1Title.Single -->\n# ${sec.heading}`); // cover: title only
      titleDone = true;
      // The H1's preamble (a description / date / attendees) is NOT a subtitle — turning
      // it into one drops every line past the first (data loss) and clutters the cover.
      // Keep it ALL on its own title-less lead-in slide instead.
      const body = sectionBody(sec.lines);
      if (body) slides.push(body);
      continue;
    }
    const body = sectionBody(sec.lines);
    const visual = keyValueTable(body); // key-value list → native table (form only)
    slides.push(`# ${sec.heading}${body ? `\n\n${visual ?? body}` : ""}`);
  }
  return slides.join("\n\n---\n\n") + "\n";
}
