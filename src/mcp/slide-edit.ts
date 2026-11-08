/**
 * slide-edit.ts — #631 (#106 P4b): the MCP door of a single-slide edit (`set_slide_markdown`).
 *
 * A bare JSON array (optionally ```json-fenced) is handed to routeOpsReply — the SAME door the refine loop
 * and the batch edit use, which calls the GUI's routeSlideEdit (R8: the MCP writes no branch of its own).
 * An ops route commits the routed slide; anything else keeps the pre-#631 Markdown path
 * (session.ts applySlideMarkdown) byte-identical, result included. A malformed ops array falls back to that
 * Markdown path with the router's notice (never silent, ADR-0018/0019); a skipped op is announced in
 * `notices` with its count in `skipped`.
 *
 * The route is noted for the call log (metrics-probe noteRoute → MetricsRecord.route/skipped). Pure engine
 * in / out like session.ts; the only non-engine import is the no-op-when-off metrics probe.
 */
import { DeckIRSchema } from "../engine/slide-schema";
import { routeOpsReply, OPS_ROUTES } from "../engine/slide-edit-route";
import { type Session, requireLoaded, assertIndex, applySlideMarkdown, slideToMarkdown, zodErr, fitTail } from "./session";
import { noteRoute } from "./metrics-probe";

export function applySlideEdit(s: Session, i: number, text: string) {
  const { deck, catalog, template } = requireLoaded(s);
  assertIndex(deck, i);
  const old = deck.slides[i];
  const r = routeOpsReply(old, text);
  if (!r || !r.slide || !OPS_ROUTES.has(r.route)) {
    const fallback = r?.route === "fallback";
    noteRoute(fallback ? "fallback" : "markdown", 0);
    const res = applySlideMarkdown(s, i, text);
    return fallback ? { ...res, route: "fallback" as const, notices: r.notices } : res;
  }
  noteRoute(r.route, r.skipped);
  const head = { route: r.route, skipped: r.skipped, notices: r.notices };
  const before = slideToMarkdown(deck, i, catalog, template.layouts);
  // STRUCTURAL changed (as applyDesignIntent): an op may change what the Markdown does not show (diagram
  // placement), and an afterMd diff would let commitMutation's no-op re-sync silently revert it.
  if (JSON.stringify(r.slide) === JSON.stringify(old)) {
    return { ok: true as const, changed: false as const, ...head, beforeMd: before, afterMd: before, ...fitTail(s, deck, catalog, template.layouts) };
  }
  const slides = [...deck.slides];
  slides[i] = r.slide;
  const check = DeckIRSchema.safeParse({ ...deck, slides });
  if (!check.success) return { ok: false as const, error: zodErr(check.error.issues), ...head };
  s.deck = check.data;
  s.dirty = true;
  const afterMd = slideToMarkdown(s.deck, i, catalog, template.layouts);
  return { ok: true as const, changed: true as const, ...head, beforeMd: before, afterMd, ...fitTail(s, s.deck, catalog, template.layouts) };
}
