/**
 * ai-apply.ts — apply an AI edit RESULT to a slide. Pure logic (R2): no DOM / Tauri.
 *
 * The AI "diagram-edit" mode returns a BARE DiagramSpec YAML (not Markdown). If the adopt path
 * parses it as Markdown it yields no diagram — so the figure edit is silently lost and the OLD
 * diagram is kept ("採用しても反映されない"). This detects that case and swaps the new YAML into
 * the slide's existing diagram.
 */
import type { SlideIR } from "./slide-schema";
import { validateDiagramSource } from "./mermaid-to-diagram";
import { applyRegionSplit } from "./design-intent";
import { parseMd } from "./md-parser";
import { serializeMd } from "./md-serializer";
import { reconcileEdit } from "./ai-reconcile";
import { validateStructure, validateCondense } from "./ai-validate";

/** DiagramSpec YAML anchors — the first meaningful line of a spec is one of these top-level keys. */
const SPEC_KEY = /^\s*(type|nodes|edges|direction|title|classDefs|groups|lanes|fragments|activations|quadrant|gantt|xychart|radar|kpi|layout)\s*:/;

/**
 * Clean a figure-YAML candidate as a ~3B model tends to return it: unwrap a ```lang … ``` fence, and
 * drop a natural-language preamble ("はい、こちらが図です:") before the first DiagramSpec key. A normal
 * Markdown edit (no spec key) is returned unchanged and then fails validation downstream.
 */
function sanitizeFigureSource(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) t = fence[1].trim();
  const lines = t.split("\n");
  const start = lines.findIndex((l) => SPEC_KEY.test(l));
  if (start > 0) t = lines.slice(start).join("\n");
  return t;
}

/**
 * If `raw` is (or wraps) a valid DiagramSpec YAML, apply it as the slide's figure; otherwise null (not
 * a figure-YAML edit — the caller falls back to the Markdown path). The raw is first sanitized (fence
 * unwrap + prose-preamble strip) so a ```yaml-fenced or "はい、図です:"-prefixed edit still applies
 * instead of leaking to the code path. Three cases:
 *   1. the slide already carries a figure → replace its YAML (the diagram-edit adopt path);
 *   2. a body-less slide → the figure fills the body;
 *   3. a slide WITH body text → ADD the figure and move the text to the other column (coexist, #3B) so
 *      "add a diagram" never destroys the existing bullets (preservation, same spirit as #12).
 */
export function applyFigureYaml(slide: SlideIR, raw: string): SlideIR | null {
  const yaml = sanitizeFigureSource(raw);
  if (validateDiagramSource(yaml, "yaml")) return null; // truthy = invalid → not a figure-YAML edit

  // 1. Replace an existing figure (diagram or mermaid).
  if (slide.diagram) return { ...slide, diagram: { ...slide.diagram, yaml } };
  if (slide.mermaidBlock) {
    const { mermaidBlock: _drop, ...rest } = slide;
    void _drop;
    return { ...rest, diagram: { yaml, placeholderIdx: slide.mermaidBlock.placeholderIdx } };
  }

  // 2/3. Add a figure to a figureless slide. Coexist with any body text (move it to the other column);
  // a body-less slide simply gets the figure in its body. layout → auto so the engine picks a fitting
  // (single-body or 2-column) layout.
  const hasBodyText = slide.placeholders.some(
    (p) => /^[1-9]$/.test(p.idx) && p.paragraphs.some((par) => par.segments.some((s) => s.text.trim())),
  );
  const withFigure: SlideIR = { ...slide, layout: "auto", diagram: { yaml, placeholderIdx: "1" } };
  return hasBodyText ? applyRegionSplit(withFigure, "text-left") : withFigure;
}

/** A slide's current figure as its fenced source block (```diagram / ```mermaid), or undefined. */
export function figureFence(slide: SlideIR): string | undefined {
  if (slide.diagram) return "```diagram\n" + slide.diagram.yaml + "\n```";
  if (slide.mermaidBlock) return "```mermaid\n" + slide.mermaidBlock.mermaid + "\n```";
  return undefined;
}

/** The before/after sides of a figure-edit change preview. */
export interface FigureEditPreview {
  /** The slide's current figure source (fenced), or "" when the edit ADDS a figure to a figureless slide. */
  beforeMd: string;
  /** The new figure source (fenced). */
  afterMd: string;
}

/**
 * Preview a diagram-edit as a FIGURE-SOURCE diff (YAML-vs-YAML) instead of full-Markdown-vs-raw-YAML.
 * The AI diagram-edit mode returns a bare DiagramSpec YAML; diffing it against the whole slide's
 * Markdown misaligns visually. Return the old vs new fenced figure block so the reviewer sees exactly
 * the diagram change. Returns null when `raw` is not a figure-YAML edit (caller uses the Markdown diff).
 * Pure (R2).
 */
export function previewFigureEdit(slide: SlideIR, raw: string): FigureEditPreview | null {
  const applied = applyFigureYaml(slide, raw);
  if (!applied) return null;
  return { beforeMd: figureFence(slide) ?? "", afterMd: figureFence(applied) ?? raw.trim() };
}

/** What an AI content edit resolves to, computed BEFORE adoption. */
export interface SlideEditReconcile {
  /** The reconciled slide that will actually be committed (structure restored from `old`). */
  slide: SlideIR;
  /** Human advisories to show in the review — structure restored / numbers-or-language changed /
   *  a broken figure kept as-is. Empty when the edit is clean. */
  warnings: string[];
}

/**
 * Reconcile + VALIDATE an AI content edit into what will actually be applied — computed at REVIEW
 * time (before 採用), not after. This puts validation on the adoption gate: the reviewer sees the
 * real reconciled result + any advisory and decides 採用/却下; once adopted the slide is valid and
 * always renders (no post-hoc blocking). Returns null when the AI output doesn't parse to a slide.
 * A broken figure is dropped so the OLD valid one is carried (and flagged), never a broken render.
 */
export function reconcileSlideEdit(old: SlideIR, rawMd: string): SlideEditReconcile | null {
  const newSlide = parseMd(rawMd).slides[0];
  if (!newSlide) return null;
  const figErr = newSlide.diagram ? validateDiagramSource(newSlide.diagram.yaml, "yaml") : null;
  const edited = figErr ? { ...newSlide, diagram: undefined } : newSlide;
  const reconciled = reconcileEdit(old, edited);
  const verdict = validateStructure(old, edited, "edit");
  const cond = validateCondense(serializeMd({ slides: [old] }), rawMd);
  const factMsgs = cond.violations.filter((w) => w.kind === "fact" || w.kind === "language").map((w) => w.detail);
  const warnings: string[] = [];
  if (figErr) warnings.push(`図の編集結果が不正なため、図は元のまま適用します（${figErr}）`);
  if (verdict.violations.length > 0) warnings.push(`構造を元から復元します（${verdict.violations.map((v) => v.detail).join(" / ")}）`);
  if (factMsgs.length > 0) warnings.push(`⚠ 数値/言語が変化しています（${factMsgs.join(" / ")}）`);
  return { slide: reconciled, warnings };
}

/**
 * Fallback-path transparency (ADR-0019 observability). When a per-slide edit on a slide that HAS a
 * figure falls through the figure/ops/design detectors to the FULL-Markdown reconcile path AND that
 * path reports drift, the model almost certainly regenerated the whole slide (format A) instead of
 * emitting figure ops (format B) — the drift is the symptom, and the reconciled result rolls back to a
 * bare "変更なし". Prepend a tag so the reviewer sees WHY it rolled back (legible, not opaque). Benign
 * text edits don't drift → not tagged. Returns the warnings unchanged when there's nothing to explain.
 */
export function figureFallbackTag(hadFigure: boolean, warnings: string[]): string[] {
  if (!hadFigure || warnings.length === 0) return warnings;
  return ["[全文フォールバック] 図の部分編集（ops）として解釈できず全文を再構成したため、以下のずれを検出しました。", ...warnings];
}
