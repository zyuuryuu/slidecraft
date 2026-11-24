/**
 * slide-edit-route.ts — #106 P4 / ADR-0019: the ONE router from a model's reply for a single slide to
 * the slide it becomes (R8). Before P4 this branch lived only in the GUI (useDeckController
 * handleApplySlide / previewSlideEdit); the batch edit and the refine loop parsed every reply as
 * Markdown, so an ops reply failed there. Now all three doors call this function.
 *
 * Order (the GUI's, moved verbatim): figure YAML → figure CONTENT ops (P1) → placeholder TEXT ops
 * (setField, P2) → DATA ops (setCell…, P3) → design intent → full-slide Markdown (reconcile). The op
 * vocabularies are disjoint and a JSON array is never a DiagramSpec, so at most one route matches.
 *
 * Contract kept from P1–P3: a skipped op is announced (never silent); a malformed ops array falls back
 * to the Markdown path with a notice ("fallback"); when nothing applied, ops routes return the ORIGINAL
 * slide object. Exception (#764): an array that parses but MIXES op families is "rejected" — no slide,
 * the notice names the families — instead of becoming the body as the array's text. Pure logic (R2).
 */
import type { SlideIR } from "./slide-schema";
import type { LayoutCatalog } from "./template-catalog";
import { serializeMd, type SerializeTemplate } from "./md-serializer";
import { autoSelectLayout } from "./template-loader";
import { parseDiagramEditOps, applyDiagramEditOps, checkDeleteIntent, buildOpsRetryInstruction, DiagramEditOpsSchema } from "./diagram-edit-ops";
import { routeFieldEdit, bareArray, FieldEditOpsSchema } from "./field-edit-ops";
import { routeDataEdit, DataEditOpsSchema } from "./chart-edit-ops";
import { parseDesignIntent, applyDesignIntentReport, DesignIntentSchema } from "./design-intent";
import { applyFigureYaml, figureFence, reconcileSlideEdit, figureFallbackTag, type FigureLayoutCtx } from "./ai-apply";

/** Which route a reply took. "fallback" = a malformed ops array handled as full Markdown (with notice).
 *  "rejected" (#764) = an ops array mixing op families — not applied at all (slide null, notice). */
export type SlideEditRoute = "figure-yaml" | "diagram-ops" | "field-ops" | "data-ops" | "design" | "markdown" | "fallback" | "rejected";

/** The routes that merge a partial edit into the existing slide (as opposed to a whole-slide rewrite). */
export const OPS_ROUTES: ReadonlySet<SlideEditRoute> = new Set<SlideEditRoute>(["diagram-ops", "field-ops", "data-ops", "design"]);

export interface RoutedSlideEdit {
  route: SlideEditRoute;
  /** The slide to commit. null only on the Markdown routes when the reply does not parse to a slide. */
  slide: SlideIR | null;
  /** Announced when the edit is applied (skipped ops, delete-intent advisories, malformed-ops fallback). */
  notices: string[];
  /** Shown at review time. Ops routes: = notices. Markdown routes: the fallback notice + reconcile advisories. */
  warnings: string[];
  /** How many ops took no effect (0 on the Markdown routes). */
  skipped: number;
  /** Markdown route only: a figure slide that drifted — the GUI may re-ask once for ops (ADR-0019 ①). */
  shouldRetry?: true;
  retryInstruction?: string;
}

export interface RouteSlideEditOpts {
  /** The user's request — enables the delete-intent cross-check on figure ops and the retry nudge. */
  instruction?: string;
  /** Binding authority for the Markdown route's reconcile (ADR-0030 stage B). */
  tpl?: SerializeTemplate;
  /** Figure-YAML placement context (GUI-shell rescue for a body-less pin, #220 A2). */
  figureCtx?: FigureLayoutCtx;
}

const opsResult = (route: SlideEditRoute, slide: SlideIR, notices: string[], skipped: number): RoutedSlideEdit =>
  ({ route, slide, notices, warnings: notices, skipped });

// ── #764: the op families, read off each route's own schema (R8: no second vocabulary list) ──
type OpSchema = { element: unknown };
function opNames(arr: OpSchema): Set<string> {
  const el = arr.element as { options?: Array<{ shape: { op: { value: unknown } } }>; shape?: { op: { value: unknown } } };
  const objs = el.options ?? (el.shape ? [el as { shape: { op: { value: unknown } } }] : []);
  return new Set(objs.map((o) => String(o.shape.op.value)));
}
const OP_FAMILIES: ReadonlyArray<readonly [family: string, ops: ReadonlySet<string>]> = [
  ["diagram", opNames(DiagramEditOpsSchema)], ["field", opNames(FieldEditOpsSchema)],
  ["data", opNames(DataEditOpsSchema)], ["design", opNames(DesignIntentSchema)],
];

/**
 * #764 — the ONE judge of "this ops array mixes op families" (GUI, refine/batch and MCP all reach it
 * through routeSlideEdit). A whole-reply array (bareArray: optionally ```-fenced) naming ops of 2+
 * families → the notice, naming each family by its first op; otherwise null (not an array, one family,
 * or no known op — those keep their pre-#764 routes).
 */
export function mixedOpsNotice(raw: string): string | null {
  const arr = bareArray(raw);
  if (!arr) return null;
  const seen = new Map<string, string>(); // family → its first op, in order of appearance
  for (const o of arr) {
    const op = typeof o === "object" && o !== null ? (o as { op?: unknown }).op : undefined;
    if (typeof op !== "string") continue;
    const family = OP_FAMILIES.find(([, ops]) => ops.has(op))?.[0];
    if (family && !seen.has(family)) seen.set(family, op);
  }
  if (seen.size < 2) return null;
  const named = [...seen].map(([family, op]) => `${op}（${family}）`).join("と ");
  return `[ops拒否] op の系統が混在: ${named}。1 回の返答の op は 1 系統だけにしてください（スライドは変更していません）。`;
}

/** Route one reply for `old` to the slide it becomes. See the module comment for the order. */
export function routeSlideEdit(old: SlideIR, raw: string, opts: RouteSlideEditOpts = {}): RoutedSlideEdit {
  const fig = applyFigureYaml(old, raw, opts.figureCtx);
  if (fig) return opsResult("figure-yaml", fig, [], 0);

  const mixed = mixedOpsNotice(raw);
  if (mixed) return { route: "rejected", slide: null, notices: [mixed], warnings: [mixed], skipped: 0 };

  const editOps = parseDiagramEditOps(raw);
  if (editOps) {
    const { slide, skipped } = applyDiagramEditOps(old, editOps);
    const notices = [
      ...skipped.map((sk) => sk.message),
      ...(opts.instruction ? checkDeleteIntent(old, editOps, opts.instruction).map((a) => a.message) : []),
    ];
    return opsResult("diagram-ops", slide, notices, skipped.length);
  }

  const field = routeFieldEdit(old, raw);
  const data = field ? null : routeDataEdit(old, raw);
  const partial = field ?? data;
  if (partial?.kind === "ops") {
    return opsResult(field ? "field-ops" : "data-ops", partial.slide, partial.notices, partial.notices.length);
  }
  const fallback = partial?.kind === "fallback" ? [partial.notice] : [];

  const intent = parseDesignIntent(raw);
  if (intent) {
    const { slide, skipped } = applyDesignIntentReport(old, intent);
    return opsResult("design", slide, skipped.map((sk) => sk.message), skipped.length);
  }

  const route: SlideEditRoute = fallback.length > 0 ? "fallback" : "markdown";
  const rec = reconcileSlideEdit(old, raw, opts.tpl);
  if (!rec) return { route, slide: null, notices: fallback, warnings: fallback, skipped: 0 };
  // L4 / Option A: a figure slide that fell to the full-Markdown path AND drifted is tagged, and is the
  // trigger for a single ops-bias retry (the nudge needs the original instruction).
  const hadFigure = !!old.diagram || !!old.mermaidBlock;
  const shouldRetry = hadFigure && rec.warnings.length > 0;
  return {
    route, slide: rec.slide, notices: fallback, skipped: 0,
    warnings: [...fallback, ...figureFallbackTag(hadFigure, rec.warnings)],
    ...(shouldRetry ? { shouldRetry: true as const, ...(opts.instruction ? { retryInstruction: buildOpsRetryInstruction(old, opts.instruction) } : {}) } : {}),
  };
}

/**
 * The apply-time banner (GUI editNotice) for a routed edit: the notices joined, or null to clear a stale
 * banner. undefined = leave the banner as it is (figure YAML; an unparseable reply that has no notice).
 */
export function editNoticeOf(r: RoutedSlideEdit): string | null | undefined {
  if (r.route === "figure-yaml") return undefined;
  if (!r.slide && r.notices.length === 0) return undefined;
  return r.notices.length > 0 ? r.notices.join(" ｜ ") : null;
}

/** The review-time view of a routed edit (the AI panel's 変更プレビュー). */
export interface SlideEditPreview { afterMd: string; warnings: string[]; beforeMd?: string; shouldRetry?: boolean; retryInstruction?: string }

/**
 * Figure routes diff the figure SOURCE (YAML-vs-YAML); text/data ops and Markdown diff the slide's
 * Markdown with its resolved layout. Design intent and an unparseable reply → null (the caller shows
 * the raw diff / nothing). A rejected reply (#764) → the slide as it is (no change) + the notice.
 */
export function previewRoutedEdit(
  old: SlideIR, raw: string, r: RoutedSlideEdit,
  ctx: { index: number; total: number; catalog?: LayoutCatalog; tpl?: SerializeTemplate },
): SlideEditPreview | null {
  if (r.route === "rejected") return { afterMd: serializeMd({ slides: [{ ...old, layout: autoSelectLayout(old, ctx.index, ctx.total, ctx.catalog) }] }, ctx.tpl), warnings: r.warnings };
  if (!r.slide || r.route === "design") return null;
  if (r.route === "figure-yaml") return { afterMd: figureFence(r.slide) ?? raw.trim(), warnings: [], beforeMd: figureFence(old) ?? "" };
  if (r.route === "diagram-ops") return { afterMd: figureFence(r.slide) ?? "", warnings: r.warnings, beforeMd: figureFence(old) ?? "" };
  const layout = autoSelectLayout(r.slide, ctx.index, ctx.total, ctx.catalog);
  const afterMd = serializeMd({ slides: [{ ...r.slide, layout }] }, ctx.tpl);
  if (OPS_ROUTES.has(r.route)) return { afterMd, warnings: r.warnings };
  return {
    afterMd, warnings: r.warnings,
    ...(r.shouldRetry ? { shouldRetry: true, ...(r.retryInstruction ? { retryInstruction: r.retryInstruction } : {}) } : {}),
  };
}

/**
 * The refine/batch door: only a reply that is a whole bare JSON array is routed (a Markdown reply keeps
 * the caller's own Markdown path, byte-identical). Returns null for a non-array reply.
 */
export function routeOpsReply(old: SlideIR, raw: string, instruction?: string): RoutedSlideEdit | null {
  return bareArray(raw) ? routeSlideEdit(old, raw, { instruction }) : null;
}
