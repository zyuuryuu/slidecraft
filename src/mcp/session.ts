/**
 * session.ts — the headless SlideCraft engine session that `slidecraft serve` (the stdio
 * MCP server) drives. ONE active project per session; pure engine in / out — NO LLM, NO
 * DOM, NO Tauri. The upstream agent IS the model, so these handlers are the DETERMINISTIC
 * halves (open / diagnose / apply / distill / visualize / validate / save / export). The
 * agent reads deck + diagnostics, supplies content, and applies it through here.
 *
 * Pure logic: imports only src/engine/* (never src/ipc or src/components), so it runs in
 * plain Node and stays out of the Vite/R5 golden surface.
 */
import { DeckIRSchema, type DeckIR, type SlideIR } from "../engine/slide-schema";
import { type TemplateData, autoSelectLayout, loadTemplate } from "../engine/template-loader";
import { buildCatalog, deckCapabilities, assessTemplateHealth, type LayoutCatalog } from "../engine/template-catalog";
import { openProject, bundleProject } from "../engine/project-io";
import { parseMd } from "../engine/md-parser";
import { serializeMd } from "../engine/md-serializer";
import { distillDeck, distillDeckReport, contentBodyBox } from "../engine/distill";
import { diagnoseDeck, type DeckIssue } from "../engine/deck-diagnostics";
import { visualizeKeyValueMd } from "../engine/slide-rewrite";
import { mermaidToDiagramSpec, validateDiagramSource, type DiagramFormat } from "../engine/mermaid-to-diagram";
import { diagramSpecToYaml } from "../engine/diagram-serialize";
import { DiagramSpecSchema } from "../engine/schema";
import { buildSlideFix, slideFixRequest } from "../engine/slide-fix";
import { parseDesignIntent, applyDesignIntentReport, applyRegionSplit } from "../engine/design-intent";
import { generatePptx } from "../engine/placeholder-filler";
import { GuardError } from "./guard-errors";

export interface Session {
  root: string | null; // an allow-listed dir for file ops, or null = --no-fs (base64 only)
  deck: DeckIR | null;
  template: TemplateData | null;
  catalog: LayoutCatalog | undefined;
  meta: { templateName: string; savedAt?: string };
  dirty: boolean;
}

export function createSession(root: string | null = null): Session {
  return { root, deck: null, template: null, catalog: undefined, meta: { templateName: "" }, dirty: false };
}

interface Loaded {
  deck: DeckIR;
  template: TemplateData;
  catalog: LayoutCatalog;
}
function requireLoaded(s: Session): Loaded {
  if (!s.deck || !s.template || !s.catalog) {
    throw new GuardError("プロジェクトが開かれていません（先に open_project を呼んでください）。", "project-not-opened");
  }
  return { deck: s.deck, template: s.template, catalog: s.catalog };
}

function assertIndex(deck: DeckIR, i: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) {
    throw new GuardError(`スライド番号が範囲外です（0..${deck.slides.length - 1}）: ${i}`, "index-out-of-range");
  }
}

/** One slide → round-trippable Markdown, with 'auto' RESOLVED first so a lone slide isn't
 *  re-pinned to Title by autoSelectLayout's first-slide rule. */
function slideToMarkdown(deck: DeckIR, i: number, catalog: LayoutCatalog | undefined): string {
  const sl = deck.slides[i];
  const resolved = sl.layout === "auto" ? autoSelectLayout(sl, i, deck.slides.length, catalog) : sl.layout;
  return serializeMd({ slides: [{ ...sl, layout: resolved }] });
}

function zodErr(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
}

/** Slides whose Mermaid has NO native renderer → they would silently vanish from a
 *  headless (no-rasterizer) PPTX export. */
function unconvertibleMermaidSlides(deck: DeckIR): number[] {
  const out: number[] = [];
  deck.slides.forEach((sl, i) => {
    if (sl.mermaidBlock && mermaidToDiagramSpec(sl.mermaidBlock.mermaid) === null) out.push(i);
  });
  return out;
}

// ── open / read ──
export async function openProjectBytes(s: Session, bytes: Uint8Array) {
  const { deck, template, meta } = await openProject(bytes);
  s.deck = deck;
  s.template = template;
  s.catalog = buildCatalog(template);
  s.meta = { templateName: meta.templateName, savedAt: meta.savedAt };
  s.dirty = false;
  return { slideCount: deck.slides.length, diagnostics: diagnoseDeck(deck, s.catalog) };
}

/** Start a FRESH project from the agent's own .pptx template + optional Markdown. Reuses
 *  the exact engine path as the GUI's Draft flow (parseMd → distillDeck), so "submit
 *  Markdown, get well-fitted slides on this template" works with zero new layout logic.
 *  With no Markdown, yields a valid single-slide deck the agent can then fill. */
export async function newProject(s: Session, templateBytes: Uint8Array, markdown?: string) {
  const template = await loadTemplate(templateBytes);
  const catalog = buildCatalog(template);
  assertTemplateUsable(catalog); // reject a structurally-unusable master, never-silent
  const deck = distillDeck(parseMd(markdown?.trim() ? markdown : "# Untitled"), catalog);
  s.template = template;
  s.catalog = catalog;
  s.deck = deck;
  s.meta = { templateName: "", savedAt: undefined };
  s.dirty = true; // a fresh, unsaved project
  return { slideCount: deck.slides.length, diagnostics: diagnoseDeck(deck, catalog) };
}

export function getDeck(s: Session): DeckIR {
  return requireLoaded(s).deck;
}
export function getDeckMarkdown(s: Session): string {
  return serializeMd(requireLoaded(s).deck);
}
export function getSlideMarkdown(s: Session, i: number): string {
  const { deck, catalog } = requireLoaded(s);
  assertIndex(deck, i);
  return slideToMarkdown(deck, i, catalog);
}
/** Body capacity (max bullets / chars-per-bullet) for THIS template's content layout — a
 *  deck-level constant from contentBodyBox, robust on alien templates. Surfaced on the
 *  diagnose read so an agent fixing overflow sees the target WITHOUT get_slide_fix_request. */
function budgetOf(catalog: LayoutCatalog): { maxBullets: number; charsPerBullet: number } | null {
  const box = contentBodyBox(catalog);
  return box ? { maxBullets: box.maxLines, charsPerBullet: box.charsPerLine } : null;
}

export function getDiagnostics(s: Session): { budget: { maxBullets: number; charsPerBullet: number } | null; issues: DeckIssue[] } {
  const { deck, catalog } = requireLoaded(s);
  return { budget: budgetOf(catalog), issues: diagnoseDeck(deck, catalog) };
}
export function getCatalog(s: Session) {
  const { catalog } = requireLoaded(s);
  const health = assessTemplateHealth(catalog);
  // Ship the body budget alongside the layout catalog so capabilities is actionable — the agent sees
  // "this template holds ~N bullets/chars" without a separate get_deck_issues call.
  return { summary: deckCapabilities(catalog, health.status), health, budget: budgetOf(catalog), entries: catalog };
}

/** Lean accessor for the authoring guides / contract digest: the loaded layout catalog + body budget
 *  WITHOUT the capabilities summary + health assessment getCatalog computes (those ship only from
 *  get_template_capabilities). The digest rides every session entry AND every list_documents row, so
 *  it must not re-run deckCapabilities/assessTemplateHealth each time. requireLoaded → never-silent. */
export function entriesAndBudget(s: Session): { entries: LayoutCatalog; budget: { maxBullets: number; charsPerBullet: number } | null } {
  const { catalog } = requireLoaded(s);
  return { entries: catalog, budget: budgetOf(catalog) };
}

/** Reject a structurally-unusable master (no title/body role even after recovery) at intake
 *  — a connected agent gets a clear error instead of silently building title-less slides. */
function assertTemplateUsable(catalog: LayoutCatalog): void {
  const health = assessTemplateHealth(catalog);
  if (health.status === "rejected") {
    const reason = health.findings.filter((f) => f.level === "block").map((f) => f.message).join(" ");
    throw new Error(`このテンプレートは使用できません: ${reason}`);
  }
}
export function getProjectMeta(s: Session) {
  const { deck } = requireLoaded(s);
  return {
    templateName: s.meta.templateName,
    savedAt: s.meta.savedAt,
    slideCount: deck.slides.length,
    dirty: s.dirty,
    root: s.root,
  };
}

// ── deterministic mutations (the agent supplies the content; the engine fits/validates) ──

/** The uniform tail every deterministic mutation returns (Theme 3 / S3): post-edit diagnostics + this
 *  template's body budget. Converging the 6 mutations onto ONE sibling shape lets the agent branch on
 *  the same fields whichever lever it pulled, and gives commitMutation a `changed` flag to gate no-ops
 *  on (a no-op mutation must not bump rev / push undo / fan out deckChanged). */
function fitTail(deck: DeckIR, catalog: LayoutCatalog): { diagnostics: DeckIssue[]; budget: { maxBullets: number; charsPerBullet: number } | null } {
  return { diagnostics: diagnoseDeck(deck, catalog), budget: budgetOf(catalog) };
}

export function applySlideMarkdown(s: Session, i: number, markdown: string) {
  const { deck, catalog } = requireLoaded(s);
  assertIndex(deck, i);
  const before = slideToMarkdown(deck, i, catalog);
  const parsedSlide = parseMd(markdown).slides[0];
  if (!parsedSlide) return { ok: false as const, error: "Markdown からスライドを解釈できませんでした（空？）。" };
  const old = deck.slides[i];
  // Preserve a diagram/mermaid the text edit doesn't carry (mirrors the GUI apply).
  const merged: SlideIR = {
    ...parsedSlide,
    diagram: parsedSlide.diagram ?? old.diagram,
    mermaidBlock: parsedSlide.mermaidBlock ?? old.mermaidBlock,
  };
  const slides = [...deck.slides];
  slides[i] = merged;
  const check = DeckIRSchema.safeParse({ ...deck, slides });
  if (!check.success) return { ok: false as const, error: zodErr(check.error.issues) };
  s.deck = check.data;
  const afterMd = slideToMarkdown(s.deck, i, catalog);
  const changed = afterMd !== before;
  s.dirty = s.dirty || changed;
  return { ok: true as const, changed, beforeMd: before, afterMd, ...fitTail(s.deck, catalog) };
}

export function applyDeckMarkdown(s: Session, markdown: string) {
  const { deck, catalog } = requireLoaded(s);
  const before = serializeMd(deck);
  const check = DeckIRSchema.safeParse(parseMd(markdown));
  if (!check.success) return { ok: false as const, error: zodErr(check.error.issues) };
  const changed = serializeMd(check.data) !== before;
  s.deck = check.data;
  s.dirty = s.dirty || changed;
  return { ok: true as const, changed, slideCount: s.deck.slides.length, ...fitTail(s.deck, catalog) };
}

/** Deterministic lever: split overflowing content slides across more slides WITHOUT
 *  shrinking fonts. The whole point of harness-over-model — never make the agent re-do it. */
export function distill(s: Session) {
  const { deck, catalog } = requireLoaded(s);
  const { deck: fitted, newIndices } = distillDeckReport(deck, catalog);
  const changed = fitted.slides.length !== deck.slides.length;
  s.deck = fitted;
  s.dirty = s.dirty || changed;
  return { ok: true as const, changed, changedSlides: newIndices, before: deck.slides.length, after: fitted.slides.length, ...fitTail(fitted, catalog) };
}

/** Deterministic lever: turn a key-value bullet run on one slide into a GFM table. When there is no
 *  key-value run to convert, that is a legitimate NON-outcome (ok:true, changed:false,
 *  status:"not-applicable") — NOT a failure (ADR-0015: don't let a no-op wear an error mask). */
export function visualizeKeyValue(s: Session, i: number) {
  const { deck, catalog } = requireLoaded(s);
  assertIndex(deck, i);
  const before = slideToMarkdown(deck, i, catalog);
  const notApplicable = () => ({ ok: true as const, changed: false as const, status: "not-applicable" as const, beforeMd: before, ...fitTail(deck, catalog) });
  const fixed = visualizeKeyValueMd(before);
  if (!fixed) return notApplicable();
  const newSlide = parseMd(fixed).slides[0];
  if (!newSlide) return notApplicable();
  const slides = [...deck.slides];
  slides[i] = newSlide;
  s.deck = { ...deck, slides };
  s.dirty = true;
  return { ok: true as const, changed: true as const, beforeMd: before, afterMd: slideToMarkdown(s.deck, i, catalog), ...fitTail(s.deck, catalog) };
}

/** Set a slide's figure from a DiagramSpec source (yaml/json) or Mermaid. Validates + canonicalizes to
 *  YAML. Replaces an existing diagram / GRADUATES a Mermaid block to a native diagram, OR — for a
 *  text-only slide (S5) — ADDS a figure into a body region of the RESOLVED layout: the placeholder is a
 *  1-based body ORDINAL resolved role-wise from the catalog (alien-safe, mirrors the GUI's nthBody),
 *  defaulting to the 1st body region; `placeholderIdxArg` targets another region on a multi-body layout.
 *  A layout with NO body region is rejected. `created` reports add (true) vs replace (false). */
export function setDiagram(s: Session, i: number, source: string, format: DiagramFormat, placeholderIdxArg?: string) {
  const { deck, catalog } = requireLoaded(s);
  assertIndex(deck, i);
  const slide = deck.slides[i];
  const existingIdx = slide.diagram?.placeholderIdx ?? slide.mermaidBlock?.placeholderIdx;
  const created = existingIdx === undefined;
  // Resolve PLACEMENT first — a figureless slide with no body region rejects with 配置先 BEFORE any
  // source-parse error (pre-S5 order). For created, require a body region on the resolved layout
  // (role-based = alien-safe) and remember whether the body already holds text.
  let ord = "1", hasBodyText = false;
  if (created) {
    const layoutName = slide.layout === "auto" ? autoSelectLayout(slide, i, deck.slides.length, catalog) : slide.layout;
    const bodyCount = catalog.find((e) => e.name === layoutName)?.bodyCount ?? 0;
    const n = Number(placeholderIdxArg ?? "1");
    if (bodyCount < 1 || !Number.isInteger(n) || n < 1 || n > bodyCount) {
      return { ok: false as const, error: `このスライドのレイアウト（${layoutName}）に図の配置先（body 領域）がありません、または placeholderIdx が範囲外です（1..${bodyCount}）。` };
    }
    ord = String(n);
    hasBodyText = slide.placeholders.some((p) => /^[1-9]$/.test(p.idx) && p.paragraphs.some((par) => par.segments.some((seg) => seg.text.trim())));
  }
  const verr = validateDiagramSource(source, format);
  if (verr) return { ok: false as const, error: verr };
  let diagramYaml: string;
  if (format === "mermaid") {
    const spec = mermaidToDiagramSpec(source);
    if (!spec) return { ok: false as const, error: "この Mermaid はネイティブ図に変換できません（gitGraph / sankey / C4 等）。" };
    diagramYaml = diagramSpecToYaml(spec);
  } else if (format === "json") {
    diagramYaml = diagramSpecToYaml(DiagramSpecSchema.parse(JSON.parse(source)));
  } else {
    diagramYaml = source; // already-valid YAML, stored verbatim (matches the GUI)
  }
  const before = slideToMarkdown(deck, i, catalog);
  let next: SlideIR;
  if (!created) {
    const placeholderIdx = placeholderIdxArg ?? existingIdx; // replace (optionally retarget to another region)
    next = { ...slide, diagram: { yaml: diagramYaml, placeholderIdx } };
    delete next.mermaidBlock; // a Mermaid slide graduates to a native diagram
  } else {
    const withFigure: SlideIR = { ...slide, diagram: { yaml: diagramYaml, placeholderIdx: ord } };
    delete withFigure.mermaidBlock;
    // COEXIST with existing body text: relocate it to the other column (regionSplit) rather than let the
    // render clobber the bullets (the body placeholder at the figure's ordinal is skipped). Mirrors the
    // GUI's applyFigureYaml (ai-apply.ts). A body region with no text just takes the figure directly.
    next = hasBodyText ? applyRegionSplit(withFigure, "text-left") : withFigure;
  }
  const slides = [...deck.slides];
  slides[i] = next;
  s.deck = { ...deck, slides };
  const afterMd = slideToMarkdown(s.deck, i, catalog);
  const changed = afterMd !== before;
  s.dirty = s.dirty || changed;
  return { ok: true as const, changed, created, beforeMd: before, afterMd, ...fitTail(s.deck, catalog) };
}

/** Apply a DESIGN intent — the spatial half of two-stage editing — to a slide's figure.
 *  The agent emits a tiny DesignIntent (ops array): regionSplit (text-left/right/diagram-only)
 *  / emphasize(nodeId) / relayout(TB/LR/RL/BT); the ENGINE computes + CLAMPS the geometry.
 *  Only meaningful on a slide that HAS a figure — figureless is rejected (not a silent no-op),
 *  and `changed` reports whether the intent actually altered the slide (e.g. unknown nodeId
 *  or a relayout to the same direction → no-op, surfaced rather than hidden). */
export function applyDesignIntent(s: Session, i: number, intentRaw: string) {
  const { deck, catalog } = requireLoaded(s);
  assertIndex(deck, i);
  const slide = deck.slides[i];
  if (!slide.diagram && !slide.mermaidBlock) {
    return { ok: false as const, error: "このスライドには図がありません（design intent は図 / mermaid を持つスライドにのみ適用できます）。" };
  }
  const intent = parseDesignIntent(intentRaw);
  if (!intent) {
    return { ok: false as const, error: 'DesignIntent を解釈できませんでした（ops 配列の JSON。例: [{"op":"relayout","direction":"LR"}]）。' };
  }
  const before = slideToMarkdown(deck, i, catalog);
  const { slide: applied, skipped } = applyDesignIntentReport(slide, intent);
  // STRUCTURAL changed — a design op can move diagram.placeholderIdx / layout, which serializeMd DROPS
  // (a single-body figure's diagram fence carries no idx, and slideToMarkdown re-resolves layout:"auto").
  // Deriving `changed` from an afterMd diff would MISS such an edit → commitMutation's no-op re-sync would
  // then silently revert it. Deep-compare the applied SlideIR instead so changed:false ⟺ content-unchanged.
  const changed = JSON.stringify(applied) !== JSON.stringify(slide);
  // `skipped` names ops that took no effect (e.g. an emphasize whose nodeId the AI renamed away) so the
  // agent gets a precise, actionable reason + the ids that DO exist (#13).
  if (!changed) return { ok: true as const, changed: false as const, skipped, beforeMd: before, afterMd: before, ...fitTail(deck, catalog) };
  const slides = [...deck.slides];
  slides[i] = applied;
  const check = DeckIRSchema.safeParse({ ...deck, slides });
  if (!check.success) return { ok: false as const, error: zodErr(check.error.issues) };
  s.deck = check.data;
  s.dirty = true;
  return { ok: true as const, changed: true as const, skipped, beforeMd: before, afterMd: slideToMarkdown(s.deck, i, catalog), ...fitTail(s.deck, catalog) };
}

/** The fix PACKET the agent fulfills AS the LLM (inverted aiFix: constraints + diagnosis
 *  in, the agent returns the edited Markdown which it then sends to apply_slide_markdown). */
export function getSlideFix(s: Session, i: number) {
  const { deck, catalog } = requireLoaded(s);
  assertIndex(deck, i);
  const issues = diagnoseDeck(deck, catalog).filter((d) => d.slideIndex === i);
  const fix = buildSlideFix(slideToMarkdown(deck, i, catalog), issues, contentBodyBox(catalog));
  return { requestText: slideFixRequest(fix), currentMarkdown: fix.currentMarkdown, issues, budget: fix.budget };
}

export function validate(s: Session) {
  const { deck } = requireLoaded(s);
  const check = DeckIRSchema.safeParse(deck);
  const deckErrors = check.success ? [] : check.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`);
  const blocked = unconvertibleMermaidSlides(deck);
  return {
    ok: deckErrors.length === 0,
    deckErrors,
    exportReadiness: blocked.length ? ("blocked" as const) : ("native-ok" as const),
    unconvertibleMermaidSlides: blocked,
  };
}

// ── persist / export (caller decides base64-over-stdio vs writing under --root) ──
export async function saveProjectBytes(s: Session): Promise<Uint8Array> {
  const { deck, template } = requireLoaded(s);
  const savedAt = new Date().toISOString();
  const bytes = await bundleProject(deck, template, { templateName: s.meta.templateName, savedAt });
  s.meta = { ...s.meta, savedAt };
  s.dirty = false;
  return bytes;
}

function stripMermaid(sl: SlideIR): SlideIR {
  const rest: SlideIR = { ...sl };
  delete rest.mermaidBlock;
  return rest;
}

/** Native-vector-only headless export (no SVG rasterizer → all native DiagramSpec/tables
 *  become editable PPTX shapes). Unconvertible Mermaid would silently VANISH, so reject by
 *  default (never-silent); "skip" omits + reports those slides. */
export async function exportPptxBytes(
  s: Session,
  onUnsupportedMermaid: "reject" | "skip" = "reject",
): Promise<{ bytes: Uint8Array; skipped: number[] }> {
  const { deck, template } = requireLoaded(s);
  const blocked = unconvertibleMermaidSlides(deck);
  if (blocked.length && onUnsupportedMermaid === "reject") {
    throw new Error(
      `変換不能な Mermaid 図があり headless export では消失します（slide ${blocked.map((i) => i + 1).join(", ")}）。` +
        `set_diagram で native 図に変換するか、GUI クライアントでラスタライズしてください。`,
    );
  }
  const exportDeck = blocked.length
    ? { ...deck, slides: deck.slides.map((sl, i) => (blocked.includes(i) ? stripMermaid(sl) : sl)) }
    : deck;
  const bytes = await generatePptx(exportDeck, template); // no rasterizer = native-vector only
  return { bytes, skipped: blocked };
}
