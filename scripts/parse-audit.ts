/**
 * parse-audit.ts — audit how ACCURATELY SlideCraft comprehends a slide master's geometry: for each
 * layout it prints the inferred placeholder ROLES, the layout classification (role + bodyCount), and
 * heuristic RED FLAGS where the identification is likely wrong. This is the measurement loop behind
 * AI-Import (docs/design/ai-import.md §5): run it on YOUR real templates to see where comprehension
 * breaks, and to measure the effect of each parse improvement.
 *
 * Usage:
 *   npx tsx scripts/parse-audit.ts <template.pptx> [more.pptx ...]
 *   npx tsx scripts/parse-audit.ts                      # audits the bundled TemplateOnly masters
 *
 * Red flags (heuristic — a flag is a "look here", not a proven error):
 *   NO-TITLE       no title role, yet a top/wide box looks title-like
 *   BODY-IN-FOOTER a content body sits in the footer band (likely a rule/label mis-read as content)
 *   UNEVEN-BODIES  ≥2 bodies with very different widths (a main+meta pair mis-read as columns?)
 *   TINY-BODY      a very small body (likely a label/decoration, not content)
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, placeholderRole } from "../src/engine/template-catalog";

const META = new Set(["date", "footer", "slideNumber"]);
const SLIDE_H = 7.5;
const BUNDLED_DIR = "public/templates/slide";

async function auditTemplate(path: string): Promise<{ flagged: number; total: number }> {
  const tpl = await loadTemplate(readFileSync(path));
  const cat = new Map(buildCatalog(tpl).map((c) => [c.name, c]));
  let flagged = 0;
  console.log(`\n\x1b[1m########## ${path.split("/").pop()}  (${tpl.layouts.length} layouts)\x1b[0m`);
  for (const l of tpl.layouts) {
    const c = cat.get(l.name);
    const phs = l.placeholders.map((ph) => ({ role: placeholderRole(ph), s: ph.style, idx: ph.idx }));
    const bodies = phs.filter((x) => x.role === "body");
    const flags: string[] = [];
    const tl = phs.find((x) => (x.s.y ?? 9) < 1.8 && (x.s.w ?? 0) > 6 && x.role !== "title" && !META.has(x.role));
    if (!phs.some((x) => x.role === "title") && tl) flags.push(`NO-TITLE(${tl.role}@${tl.idx})`);
    const bf = bodies.filter((x) => (x.s.y ?? 0) > 0.84 * SLIDE_H);
    if (bf.length) flags.push(`BODY-IN-FOOTER(${bf.map((x) => x.idx).join(",")})`);
    if (bodies.length >= 2) {
      const ws = bodies.map((x) => x.s.w ?? 0);
      const r = Math.max(...ws) / Math.max(0.01, Math.min(...ws));
      if (r > 2.2) flags.push(`UNEVEN-BODIES(${r.toFixed(1)}x)`);
    }
    const tiny = bodies.filter((x) => (x.s.w ?? 0) > 0 && (x.s.w ?? 0) * (x.s.h ?? 0) < 0.4);
    if (tiny.length) flags.push(`TINY-BODY(${tiny.map((x) => x.idx).join(",")})`);
    if (flags.length) flagged++;
    const tag = flags.length ? `\x1b[33m🚩 ${flags.join(" ; ")}\x1b[0m` : "\x1b[32mok\x1b[0m";
    console.log(`  ${l.name.padEnd(24)} role=${(c?.role ?? "?").padEnd(9)} bc=${String(c?.bodyCount ?? "?").padEnd(2)} ${tag}`);
    console.log(`      ${phs.map((x) => `${x.role}@${x.idx}(${(x.s.x ?? 0).toFixed(1)},${(x.s.y ?? 0).toFixed(1)} ${(x.s.w ?? 0).toFixed(1)}×${(x.s.h ?? 0).toFixed(1)})`).join("  ")}`);
  }
  console.log(`  \x1b[1m→ ${flagged}/${tpl.layouts.length} flagged\x1b[0m`);
  return { flagged, total: tpl.layouts.length };
}

async function main() {
  const args = process.argv.slice(2);
  const paths = args.length
    ? args
    : existsSync(BUNDLED_DIR)
      ? readdirSync(BUNDLED_DIR).filter((f) => f.endsWith("TemplateOnly.pptx")).map((f) => join(BUNDLED_DIR, f))
      : [];
  if (paths.length === 0) {
    console.error("no templates. Usage: npx tsx scripts/parse-audit.ts <template.pptx> [...]");
    process.exit(1);
  }
  let totFlag = 0, tot = 0;
  for (const p of paths) {
    if (!existsSync(p)) { console.error(`skip (missing): ${p}`); continue; }
    const { flagged, total } = await auditTemplate(p);
    totFlag += flagged; tot += total;
  }
  console.log(`\n\x1b[1m===== TOTAL: ${totFlag}/${tot} layouts flagged across ${paths.length} template(s) =====\x1b[0m`);
}

void main();
