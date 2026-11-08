/**
 * slide-role-regions.ts — classify a slide into the layout ROLE + number of body regions it needs, and
 * pick a template layout for that role. Split out of template-loader.ts (R1) for #392 段 2, which made the
 * classification read the PLACED ordinals of every visual (figure-placement) and added the 2-figure
 * `chart` role (Chart.2Chart.Equal), degrading to a 2-column layout on templates without one.
 *
 * Pure logic (R2).
 */
import type { SlideIR, LayoutName, TableBlock } from "./slide-schema";
import { pickLayout, CLOSING_RE, type LayoutCatalog, type LayoutRole, type CatalogEntry } from "./template-catalog";
import { placedFigures, type PlacedFigure } from "./figure-placement";

export interface RolePick { role: LayoutRole; regions: number | undefined; fallback: string; visual?: VisualRole; }

/** #598: a slide made of images alone, which an image-structure layout fits better than its text role. A HINT
 *  on top of the role (which stays content / columns, so every caller that reads the role is unchanged):
 *  pickRoleLayout takes a layout of this role with exactly `count` picture frames when the template has one,
 *  and the old pick otherwise — templates without Image.* / Gallery.* layouts choose byte-identically.
 *   - gallery: a title, no body text, 2+ body visuals that are all images (a grid / diptych / logo wall).
 *   - image: a title, no body text, no body visual, and a behind image (`{behind=1}` = the full-bleed backdrop).
 *  One image with no text stays content (Media.* — Pitch's logo slide); a behind image under text is a backdrop. */
export interface VisualRole { role: "image" | "gallery"; count: number; }

function visualRole(slide: SlideIR, placed: readonly PlacedFigure[], hasTitle: boolean, textBody: boolean): VisualRole | undefined {
  if (!hasTitle || textBody) return undefined;
  if (placed.length === 0) return slide.image?.behind ? { role: "image", count: 1 } : undefined;
  const images = placed.length >= 2 && !slide.image?.behind && placed.every((p) => p.figure.kind === "image");
  return images ? { role: "gallery", count: placed.length } : undefined;
}

/** The no-template answer of autoSelectLayout, keyed by the slide's role (+ region count) in the
 *  canonical vocabulary — NOT by index into LAYOUT_NAMES' file order, which encoded the 30-layout
 *  development master's ordering (#117). `satisfies` keeps every entry a real canonical name. */
export const CANONICAL_FALLBACK = {
  title: "Title.1Title.Single",
  section: "Section.1Title.Single",
  content: "Content.1Body.Single", // also code (1 body) and the catch-all
  columns2: "Column.2Body.Equal",
  columns3: "Column.3Body.Equal",
  chart2: "Chart.2Chart.Equal", // #392 段 2: two figures side by side (no body text)
  closing: "Closing.1Message.Single",
  closingWithBody: "Closing.1Steps.Single+1Notes",
  statement: "Statement.1Message.Single", // #593: `<!-- statement -->`
  quote: "Quote.1Message.Single+1Attribution", // #593: `<!-- quote -->`
} as const satisfies Record<string, LayoutName>;

/** Classify a slide → the ideal layout ROLE + body-region count (+ a canonical fallback name).
 *  Shared by autoSelectLayout (pick the single best) and suggestLayouts (rank candidates), so the
 *  auto pick and the suggestion list can never disagree about the slide's intent. */
export function slideRoleRegions(slide: SlideIR, slideIndex: number, totalSlides: number): RolePick {
  const pick = classifySlide(slide, slideIndex, totalSlides);
  if (pick.role !== "content" && pick.role !== "columns") return pick;
  const visual = visualRole(slide, placedFigures(slide), slide.placeholders.some((p) => p.idx === "15"), slide.placeholders.some((p) => /^[1-9]$/.test(p.idx)));
  return visual ? { ...pick, visual } : pick;
}

function classifySlide(slide: SlideIR, slideIndex: number, totalSlides: number): RolePick {
  const idxs = new Set(slide.placeholders.map((p) => p.idx));
  const hasTitle = idxs.has("15");
  const hasCtrTitle = idxs.has("0");
  // A diagram/mermaid/table/code/image occupies a body placeholder even though it isn't in `placeholders`.
  // EVERY visual's ordinal counts (#390) — a slide can carry more than one (e.g. col 1 table + col 2
  // diagram), and reading only the first would miss the region the others need. #392 段 2: the PLACED
  // ordinals (figure-placement, R8 — the ones the renderers fill; 表＋図 at "1"/"1" are 1 and 2 here)
  // + a behind image, which has always counted here.
  const placed = placedFigures(slide);
  const visualIdxs = [...placed.map((p) => p.ordinal), ...(slide.image?.behind ? [slide.image.placeholderIdx] : [])];
  const hasVisual = visualIdxs.length > 0;
  const hasBody = idxs.has("1") || visualIdxs.includes("1");
  const hasIdx2 = idxs.has("2") || visualIdxs.includes("2");
  const hasIdx3 = idxs.has("3") || visualIdxs.includes("3");
  // Closing intent lives in the HEADING (idx 15/0), not a stray body mention — so scope to the title
  // and use the SHARED closing vocabulary (CLOSING_RE) the layout classifier uses. This fixes both the
  // miss (まとめ/おわりに/ご清聴/Next steps were never routed to a Closing layout) and the false-positive
  // (a content slide whose body merely says "thank …" was coerced to closing). The slideIndex===last
  // gate below + pickLayout's closing→content degrade keep healthy decks unchanged.
  const titleText = slide.placeholders
    .filter((p) => p.idx === "15" || p.idx === "0")
    .flatMap((p) => p.paragraphs.flatMap((pp) => pp.segments.map((s) => s.text)))
    .join(" ");
  const isClosing = CLOSING_RE.test(titleText);

  // Index-0 slides default to a Title (cover) slide, EXCEPT a real content slide authored first (no
  // separate cover): a title WITH body (idx 15 + idx 1). The parser stores every `# X`/`## Y` in the
  // content namespace (idx 15/16) regardless of position, so a cover (`# 表紙 / ## サブ` → idx 15/16,
  // NO body) still coerces to Title here — the distinguisher is hasBody. Without this, a content slide
  // at idx 0 is read through the empty title namespace (idx 0/1) and serializes mangled. See
  // serializer-content-index0.test.ts.
  // A first slide coerces to the Title (cover) role — UNLESS it carries a REAL body. "Real body" means
  // idx 1 as a BODY, not idx 1 as a title-namespace cover's SUBTITLE (which coexists with a ctrTitle at
  // idx 0). So the carve-out is `hasBody && !hasCtrTitle`: a body-only first slide (bullets, no title —
  // idx 1, no idx 0/15) falls through to content instead of binding into the cover's subtitle slot,
  // while a real cover (idx 15/16, or ctrTitle idx 0 + subtitle idx 1) still coerces to title. This
  // subsumes the old hasTitle&&hasBody carve-out. See serializer-content-index0.test.ts.
  // #195: an explicit `<!-- section -->` chapter divider authored FIRST is still a chapter divider,
  // not a cover — without this gate the index-0 branch above coerces it to Title, whose namespace
  // (idx0/ctrTitle) can't carry the idx15 title serializeSlide reads, so the title silently vanishes
  // on round-trip. sectionBreak is only ever set by the explicit marker (md-slide-parser.ts), so
  // unmarked decks are unaffected — byte-identical.
  if (slideIndex === 0 && !hasVisual && !slide.sectionBreak && !(hasBody && !hasCtrTitle)) return { role: "title", regions: undefined, fallback: CANONICAL_FALLBACK.title };
  // #153: a closing slide with body content (bullets) needs the body-bearing closing layout
  // (Closing.1Steps.Single+1Notes), not the ctrTitle-only one — pickLayout's closing-role filter
  // does the actual routing/degrade; regions:1 just signals "this closing has body content".
  if (isClosing && slideIndex === totalSlides - 1) {
    return hasBody
      ? { role: "closing", regions: 1, fallback: CANONICAL_FALLBACK.closingWithBody }
      : { role: "closing", regions: undefined, fallback: CANONICAL_FALLBACK.closing };
  }
  // A code block beside body text (#390: moved to ordinal 2) needs a 2-region layout, not the 1-body
  // code layout — fall through to the columns classification below, the same way a diagram does.
  if (placed.length === 1 && placed[0].figure.kind === "code" && placed[0].ordinal === "1") return { role: "code", regions: 1, fallback: CANONICAL_FALLBACK.content };
  // #392 段 2: exactly two figures (diagram / mermaid) written one after another (no body text, both stored
  // at ONE ordinal — figure-placement separated them) → the 2-chart layout (Chart.2Chart.Equal);
  // pickRoleLayout degrades to a 2-column layout where the template has none. Figures the author put in
  // `<!-- col -->` columns (distinct stored ordinals) stay a columns slide — the serializer writes the
  // col markers back from the Column.* layout, so they round-trip.
  const textBody = slide.placeholders.some((p) => /^[1-9]$/.test(p.idx));
  const sideBySide = placed.length === 2 && new Set(placed.map((p) => p.figure.placeholderIdx)).size === 1;
  if (hasTitle && !textBody && sideBySide && placed.every((p) => p.figure.kind === "diagram" || p.figure.kind === "mermaid")) {
    return { role: "chart", regions: 2, fallback: CANONICAL_FALLBACK.chart2 };
  }
  if (hasTitle && hasBody && hasIdx2 && hasIdx3) return { role: "columns", regions: 3, fallback: CANONICAL_FALLBACK.columns3 };
  if (hasTitle && hasBody && hasIdx2) return { role: "columns", regions: 2, fallback: CANONICAL_FALLBACK.columns2 };
  if ((hasTitle || hasCtrTitle) && hasBody) return { role: "content", regions: 1, fallback: CANONICAL_FALLBACK.content };
  if (hasTitle && !hasBody) return { role: "section", regions: undefined, fallback: CANONICAL_FALLBACK.section };
  return { role: "content", regions: 1, fallback: CANONICAL_FALLBACK.content };
}

/** #672: how many picture frames a layout of the visual's role has to spare over its images — 0 = exact (the
 *  layout pickRoleLayout takes), undefined = another role or too few frames (an image would be dropped). The ONE
 *  frame test pickRoleLayout and suggestLayouts' ranking both read (R8). */
export function visualFrameSlack(e: CatalogEntry, visual: VisualRole): number | undefined {
  if (e.role !== visual.role) return undefined;
  const slack = e.placeholders.filter((p) => p.role === "picture").length - visual.count;
  return slack >= 0 ? slack : undefined;
}

/** suggestLayouts' role + count term: 0 for the slide's role with a fitting count, +50 for another role, +5 per
 *  region (or spare picture frame) off. #672: a layout of the slide's VISUAL role that loses no image counts as
 *  the slide's role, ranked by spare frames — so a Gallery slide's alternatives start with the other Gallery.*. */
export function roleCountMismatch(e: CatalogEntry, role: LayoutRole, regions: number | undefined, visual?: VisualRole): number {
  const slack = visual ? visualFrameSlack(e, visual) : undefined;
  if (slack !== undefined) return slack * 5;
  return (e.role === role ? 0 : 50) + (regions !== undefined ? Math.abs(e.bodyCount - regions) * 5 : 0);
}

/** pickLayout for the classified role. A `chart` slide (two figures) takes a chart layout with exactly
 *  that many regions, else a columns layout — never a 1-chart(+analysis) layout or a content layout with
 *  a callout box, whose 2nd "body" is a side note. Every other role: pickLayout as is (byte-identical). */
export function pickRoleLayout(
  catalog: LayoutCatalog,
  role: LayoutRole,
  regions: number | undefined,
  hasImage: boolean,
  table: Pick<TableBlock, "rows" | "placeholderIdx"> | undefined,
  visual?: VisualRole,
): CatalogEntry | undefined {
  if (visual) {
    // #598: the image-structure layout whose picture frames match the image count; none → the old pick below.
    const hit = pickLayout(catalog.filter((e) => visualFrameSlack(e, visual) === 0), visual.role, undefined, true);
    if (hit) return hit;
  }
  if (role !== "chart") return pickLayout(catalog, role, regions, hasImage, table);
  // Canonical names state the chart count (`Chart.<N>Chart.*`); `Chart.1Chart.Single+1Analysis` has 2
  // bodies but 1 chart — its 2nd body is the analysis box (#657 D1). Non-canonical names: bodyCount only.
  const chartsOk = (e: CatalogEntry) => Number(/(\d+)Chart/.exec(e.name)?.[1] ?? regions) === regions;
  return pickLayout(catalog.filter((e) => e.bodyCount === regions && chartsOk(e)), "chart", regions, hasImage, table)
    ?? pickLayout(catalog, "columns", regions, hasImage, table);
}

/** The slide's first table as layout scoring reads it (#444 overflow demotion): at its PLACED ordinal,
 *  the box it is actually drawn in (figure-placement). A lone table keeps its stored ordinal. */
export function tableForPick(slide: SlideIR): Pick<TableBlock, "rows" | "placeholderIdx"> | undefined {
  const t = placedFigures(slide).find((p) => p.figure.kind === "table");
  return t && t.figure.kind === "table" ? { rows: t.figure.rows, placeholderIdx: t.ordinal } : undefined;
}
