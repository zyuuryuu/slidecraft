/**
 * style-metrics.ts — #597 (#580 段 2-e): run ONE manuscript through several templates and measure the
 * style axes as JSON, so a style (公文書・技術文書・セールスピッチ・エグゼクティブ・マーケ) can be checked
 * against its target band (STYLE_TARGETS) — the acceptance tool for #595/#596.
 *
 * Each template goes through the real intake (`newProject` = parse → auto-split → diagnose, the same
 * path as the MCP tools), then per slide on the layout the export resolves:
 *   - chars          : visible text characters (placeholder text + table cells; whitespace excluded,
 *                      figures' internal labels not counted)
 *   - imageArea      : drawn image area ÷ slide area, summed over EVERY image the export draws (the
 *                      behind image + each region-bound one) — read off the export's own figure plan
 *                      (planSlideFigures over figureRegions → drawnImage, R8: no second enumeration or
 *                      geometry; #671 — it used to read only the singular slide.image = the 1st image)
 *   - whitespace     : 1 − (content "ink" area ÷ slide area). Ink = what this slide draws ON TOP OF the
 *                      empty layout (so template decoration never counts): text boxes sized to their
 *                      estimated lines (placeholderFitBox / paragraphLines — the split estimator), the
 *                      boxes visuals replace, drawn images and the #597 source note, unioned on a
 *                      0.05in grid. A geometric model, not a raster diff: it needs no browser, so it
 *                      runs in the required CI job. (A pixel diff via get_deck_image can refine it later.)
 *   - lossIssues     : diagnostics whose content does not reach the output (LOSS_RULES)
 * plus per template: slides, autoSplit (slides added by the intake split), rescued rows (#597 info).
 *
 * Usage: npx tsx scripts/style-metrics.ts <deck.md> [--template <file.pptx>]... [--style <style>]
 *        (default templates: the 3 shipped ones in public/templates/slide/)
 */
import { readFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as S from "../src/mcp/session";
import { parseMdReport } from "../src/engine/md-parser";
import { autoSelectLayout, findLayout, type LayoutInfo } from "../src/engine/template-loader";
import { placeholderFitBox } from "../src/engine/template-catalog";
import { slideBindingPlan } from "../src/engine/group-binding";
import { planFieldRescue, applyFieldRescue } from "../src/engine/field-rescue";
import { paragraphLines } from "../src/engine/distill";
import { visualOccupancy, drawnImage, SLIDE_IN } from "../src/engine/visual-placement";
import { planSlideFigures } from "../src/engine/slide-figure-ooxml";
import type { SlideIR, PlaceholderContent, ImageRect } from "../src/engine/slide-schema";
import type { ReviewRuleId } from "../src/engine/deck-diagnostics";

/** Diagnostics whose content never reaches the output (#580 「消失系」: unbound / shadowed / 画像記法の残り
 *  and the parser's drops). Some are info-level in REVIEW_RULES; all of them mean "something is missing". */
export const LOSS_RULES: readonly ReviewRuleId[] = [
  "unbound-content", "visual-shadowed-content", "image-markdown-leftover",
  "table-dropped", "image-dropped", "meta-key-dropped", "figure-dropped", "pre-separator-dropped",
];

export interface SlideMetrics { layout: string; chars: number; imageArea: number; whitespace: number; }
export interface TemplateMetrics {
  template: string;
  slides: number;
  autoSplit: number;
  charsPerSlide: number;
  imageAreaRatio: number;
  whitespaceRatio: number;
  lossIssues: number;
  rescued: number;
  perSlide: SlideMetrics[];
}
export interface StyleMetricsReport { manuscript: string; templates: TemplateMetrics[]; }

/** Target bands per style (#580 評価軸). Only the bands #580 states are set; the others gate structural
 *  health only (nothing lost, nothing auto-split) until a baseline deck is measured for them.
 *
 *  marketing.minImageAreaRatio (#671 較正): a DECK mean, so the text-structure slides (表紙・章扉・KPI・
 *  手順・締め) count as 0. Measured on each style's target deck with its preset (all images counted):
 *  Campaign / samples/manuscript-07 = 0.256 (全面 1.0・左キャプション 0.419・2×2 0.565・並置 0.575 ／ 10 枚),
 *  Pitch / manuscript-05 = 0.025, Executive / manuscript-06 = 0. 0.2 = "2 full-bleed images' worth in 10
 *  slides": the Campaign deck passes with ~20% headroom, Pitch (8× lower) and Executive do not. The
 *  uncalibrated #580 value 0.5 assumed a per-image-slide ratio, which no deck mean with text slides reaches. */
export type StyleName = "report" | "official" | "pitch" | "executive" | "marketing";
export interface TargetBand { maxCharsPerSlide?: number; minImageAreaRatio?: number; maxLossIssues: number; maxAutoSplit?: number; }
export const STYLE_TARGETS: Record<StyleName, TargetBand> = {
  report: { maxLossIssues: 0, maxAutoSplit: 0 },
  official: { maxLossIssues: 0, maxAutoSplit: 0 },
  pitch: { maxCharsPerSlide: 60, maxLossIssues: 0 },
  executive: { maxLossIssues: 0 },
  marketing: { maxCharsPerSlide: 25, minImageAreaRatio: 0.2, maxLossIssues: 0 },
};

const SLIDE_AREA = SLIDE_IN.w * SLIDE_IN.h;
const GRID = 0.05; // inches per ink-grid cell
const round = (n: number) => Math.round(n * 1000) / 1000;
const visible = (s: string) => [...s.replace(/\s/g, "")].length;

function slideChars(slide: SlideIR): number {
  const text = slide.placeholders.reduce((n, c) => n + c.paragraphs.reduce((m, p) => m + visible(p.segments.map((x) => x.text).join("")), 0), 0);
  return text + (slide.table?.rows.flat().reduce((n, cell) => n + visible(cell), 0) ?? 0);
}

/** Every drawn image rect, exactly as the export places them: its own figure plan (the behind image +
 *  each region-bound image, from figureRegions), each fitted by drawnImage. Empty when none is drawn. */
function imagesDrawn(slide: SlideIR, layout: LayoutInfo): ImageRect[] {
  const plan = planSlideFigures(slide, layout.placeholders);
  return [...(plan.behind ? [plan.behind] : []), ...plan.images].map((p) => drawnImage(p.image, p.box).rect);
}

/** The rects this slide draws over its empty layout (see the module header). */
function inkRects(slide: SlideIR, layout: LayoutInfo): ImageRect[] {
  const plan = slideBindingPlan(slide, layout);
  const bound = new Map<string, PlaceholderContent>(plan.assignments.map((a) => [a.placeholder.idx, a.content.content]));
  const rescue = planFieldRescue(slide, layout, bound);
  const content = applyFieldRescue(bound, rescue);
  const occupied = visualOccupancy(slide, layout.placeholders);
  const rects: ImageRect[] = [];
  for (const ph of layout.placeholders) {
    const s = ph.style;
    if (occupied.has(ph.idx)) { if (occupied.get(ph.idx) !== "image") rects.push(s); continue; }
    const c = content.get(ph.idx);
    if (!c) continue;
    const fit = placeholderFitBox(s);
    const fontIn = s.fontSize / 72;
    const lines = c.paragraphs.reduce((n, p) => n + paragraphLines(p, fit.charsPerLine), 0);
    const longest = Math.max(0, ...c.paragraphs.map((p) => visible(p.segments.map((x) => x.text).join(""))));
    const w = lines > 1 ? s.w : Math.min(s.w, longest * fontIn + 0.2);
    rects.push({ x: s.x, y: s.y, w, h: Math.min(s.h, lines * fontIn * 1.2 + 0.2) });
  }
  rects.push(...imagesDrawn(slide, layout));
  if (rescue.note) rects.push(rescue.note.rect);
  return rects;
}

/** Union area of `rects` (clipped to the slide), on the GRID. */
function unionArea(rects: readonly ImageRect[]): number {
  const cols = Math.ceil(SLIDE_IN.w / GRID);
  const rows = Math.ceil(SLIDE_IN.h / GRID);
  const ink = new Uint8Array(cols * rows);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x / GRID)), x1 = Math.min(cols, Math.ceil((r.x + r.w) / GRID));
    const y0 = Math.max(0, Math.floor(r.y / GRID)), y1 = Math.min(rows, Math.ceil((r.y + r.h) / GRID));
    for (let y = y0; y < y1; y++) ink.fill(1, y * cols + x0, y * cols + Math.max(x0, x1));
  }
  return ink.reduce((n, v) => n + v, 0) * GRID * GRID;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function measureTemplate(markdown: string, name: string, bytes: Uint8Array): Promise<TemplateMetrics> {
  const s = S.createSession(null);
  const { diagnostics } = await S.newProject(s, bytes, markdown);
  const { deck, catalog, template } = { deck: s.deck!, catalog: s.catalog!, template: s.template! };
  const parsed = parseMdReport(markdown, catalog).deck.slides.length; // newProject's own parse, before the split
  const perSlide = deck.slides.map((slide, i): SlideMetrics => {
    const layout = findLayout(template, autoSelectLayout(slide, i, deck.slides.length, catalog))!;
    const imgArea = imagesDrawn(slide, layout).reduce((n, r) => n + r.w * r.h, 0);
    return {
      layout: layout.name,
      chars: slideChars(slide),
      imageArea: round(Math.min(1, imgArea / SLIDE_AREA)),
      whitespace: round(1 - unionArea(inkRects(slide, layout)) / SLIDE_AREA),
    };
  });
  return {
    template: name,
    slides: deck.slides.length,
    autoSplit: deck.slides.length - parsed,
    charsPerSlide: round(mean(perSlide.map((p) => p.chars))),
    imageAreaRatio: round(mean(perSlide.map((p) => p.imageArea))),
    whitespaceRatio: round(mean(perSlide.map((p) => p.whitespace))),
    lossIssues: diagnostics.filter((d) => d.id && LOSS_RULES.includes(d.id)).length,
    rescued: diagnostics.filter((d) => d.id === "field-row-rescued").length,
    perSlide,
  };
}

export async function styleMetrics(manuscript: string, markdown: string, templates: ReadonlyArray<{ name: string; bytes: Uint8Array }>): Promise<StyleMetricsReport> {
  const out: TemplateMetrics[] = [];
  for (const t of templates) out.push(await measureTemplate(markdown, t.name, t.bytes));
  return { manuscript, templates: out };
}

/** Which bands of `style` each template misses (empty list = within the band). */
export function evaluateTargets(report: StyleMetricsReport, style: StyleName): Array<{ template: string; misses: string[] }> {
  const b = STYLE_TARGETS[style];
  return report.templates.map((t) => {
    const misses: string[] = [];
    if (b.maxCharsPerSlide !== undefined && t.charsPerSlide > b.maxCharsPerSlide) misses.push(`charsPerSlide ${t.charsPerSlide} > ${b.maxCharsPerSlide}`);
    if (b.minImageAreaRatio !== undefined && t.imageAreaRatio < b.minImageAreaRatio) misses.push(`imageAreaRatio ${t.imageAreaRatio} < ${b.minImageAreaRatio}`);
    if (t.lossIssues > b.maxLossIssues) misses.push(`lossIssues ${t.lossIssues} > ${b.maxLossIssues}`);
    if (b.maxAutoSplit !== undefined && t.autoSplit > b.maxAutoSplit) misses.push(`autoSplit ${t.autoSplit} > ${b.maxAutoSplit}`);
    return { template: t.template, misses };
  });
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_TEMPLATES = [
  "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx",
  "public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx",
  "public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx",
].map((p) => join(ROOT, p));
const USAGE = "Usage: npx tsx scripts/style-metrics.ts <deck.md> [--template <file.pptx>]... [--style report|official|pitch|executive|marketing]";

/** CLI core (tests call this directly; it never touches process). */
export async function runCli(argv: readonly string[], readFile: (path: string) => Uint8Array): Promise<{ code: number; stdout: string; stderr: string }> {
  const fail = (msg: string) => ({ code: 2, stdout: "", stderr: `style-metrics: ${msg}\n${USAGE}\n` });
  let md: string | undefined;
  const tpls: string[] = [];
  let style: StyleName | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--template") { if (!argv[i + 1]) return fail("--template needs a path"); tpls.push(argv[++i]); }
    else if (a === "--style") {
      const v = argv[++i];
      if (!v || !(v in STYLE_TARGETS)) return fail(`unknown style: ${v ?? "(none)"}`);
      style = v as StyleName;
    } else if (a.startsWith("--")) return fail(`unknown option: ${a}`);
    else if (md === undefined) md = a;
    else return fail(`unexpected argument: ${a}`);
  }
  if (!md) return fail("missing <deck.md>");
  const markdown = new TextDecoder().decode(readFile(md));
  const report = await styleMetrics(basename(md), markdown, (tpls.length ? tpls : DEFAULT_TEMPLATES).map((p) => ({ name: basename(p), bytes: readFile(p) })));
  const body = style ? { ...report, style, targets: STYLE_TARGETS[style], evaluation: evaluateTargets(report, style) } : report;
  return { code: 0, stdout: `${JSON.stringify(body, null, 2)}\n`, stderr: "" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), (p) => readFileSync(p)).then((r) => {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.code;
  });
}
