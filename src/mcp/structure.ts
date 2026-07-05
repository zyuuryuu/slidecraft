/**
 * structure.ts — surgical deck STRUCTURE operations for the upstream AI (Theme 3, S4): insert /
 * delete / move / duplicate a single slide. These are the gap set_deck_markdown can't fill — a
 * whole-deck rewrite drops every native figure (applyDeckMarkdown does no figure-preserve), so adding
 * or removing ONE slide via regen silently destroys the others' diagrams/tables. These ops touch only
 * the deck.slides ARRAY, so they preserve each surviving slide's figure/layout byte-identical and need
 * NO schema change (R4). Split out of session.ts to keep it under the 400-line cap (R1); uses only the
 * PUBLIC session surface + engine (no session internals). See docs/design/mcp-brushup.md §B.
 *
 * Naming: structure verbs insert_/delete_/move_/duplicate_ vs content verbs set_/apply_/convert_/split_
 * so the prefix alone routes the AI.
 */
import type { Session } from "./session";
import * as S from "./session";
import { SlideIRSchema } from "../engine/slide-schema";
import { parseMd } from "../engine/md-parser";
import { insertSlideAt, deleteSlideAt, duplicateSlideAt, moveSlideTo } from "../engine/deck-structure";
import { GuardError } from "./guard-errors";

function assertIdx(len: number, i: number, label = "index"): void {
  if (!Number.isInteger(i) || i < 0 || i >= len) throw new GuardError(`${label} が範囲外です（0..${len - 1}）: ${i}`, "index-out-of-range");
}
/** The uniform envelope tail (post-op diagnostics + body budget) via the public diagnose read — same
 *  shape the deterministic mutations return (Theme 3 S3), so the AI branches on identical fields. */
function tail(s: Session): { diagnostics: ReturnType<typeof S.getDiagnostics>["issues"]; budget: ReturnType<typeof S.getDiagnostics>["budget"] } {
  const d = S.getDiagnostics(s);
  return { diagnostics: d.issues, budget: d.budget };
}
function zerr(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
}

/** Insert a NEW slide (from Markdown, layout defaults to 'auto' → resolved per input master = alien-safe)
 *  before/after an existing slide. */
export function insertSlide(s: Session, index: number, markdown: string, position: "before" | "after" = "before") {
  const deck = S.getDeck(s); // never-silent if no project open
  assertIdx(deck.slides.length, index);
  // insert takes EXACTLY one slide — reject empty AND multi-slide never-silently (parseMd splits on '---',
  // so multi-slide markdown would otherwise drop slides 2..N silently — the very loss these ops exist to avoid).
  const parsed = parseMd(markdown);
  if (parsed.slides.length !== 1) {
    return {
      ok: false as const,
      error: parsed.slides.length === 0
        ? "Markdown からスライドを解釈できませんでした（空？）。"
        : `insert_slide は1枚だけ挿入します（${parsed.slides.length}枚検出）。複数枚は1枚ずつ insert するか set_deck_markdown を使ってください。`,
    };
  }
  const check = SlideIRSchema.safeParse(parsed.slides[0]); // validate ONLY the new slide; survivors keep refs
  if (!check.success) return { ok: false as const, error: zerr(check.error.issues) };
  const { deck: nextDeck, at } = insertSlideAt(deck, index, check.data, position);
  s.deck = nextDeck; // survivors byte-identical (no whole-deck reparse)
  s.dirty = true;
  return { ok: true as const, changed: true as const, insertedIndex: at, slideCount: nextDeck.slides.length, insertedMd: S.getSlideMarkdown(s, at), ...tail(s) };
}

/** Delete a slide. Rejects removing the LAST remaining slide never-silently (DeckIR requires ≥1), and
 *  returns the removed slide's Markdown so the op is inspectable/reversible by the AI. */
export function deleteSlide(s: Session, index: number) {
  const deck = S.getDeck(s);
  assertIdx(deck.slides.length, index);
  const next = deleteSlideAt(deck, index);
  if (!next) return { ok: false as const, error: "最後の1枚は削除できません（deck は最低1枚必要です）。" };
  const deletedMd = S.getSlideMarkdown(s, index); // read the doomed slide before swapping s.deck
  s.deck = next; // removing from a valid deck (len ≥ 2 here) stays valid — no re-parse needed
  s.dirty = true;
  return { ok: true as const, changed: true as const, deletedIndex: index, deletedMd, slideCount: next.slides.length, ...tail(s) };
}

/** Move a slide from one position to another (pure permutation — content/figures/layouts untouched).
 *  `toIndex` is the destination index; from===to is a surfaced no-op (changed:false), not an error. */
export function moveSlide(s: Session, fromIndex: number, toIndex: number) {
  const deck = S.getDeck(s);
  assertIdx(deck.slides.length, fromIndex, "fromIndex");
  assertIdx(deck.slides.length, toIndex, "toIndex");
  if (fromIndex === toIndex) return { ok: true as const, changed: false as const, fromIndex, toIndex, slideCount: deck.slides.length, ...tail(s) };
  const next = moveSlideTo(deck, fromIndex, toIndex);
  s.deck = next;
  s.dirty = true;
  return { ok: true as const, changed: true as const, fromIndex, toIndex, slideCount: next.slides.length, ...tail(s) };
}

/** Duplicate a slide via a deep structuredClone (NOT via Markdown) so the copy's diagram / table / code
 *  survive byte-identical — Markdown is not a lossless carrier for those. The copy lands adjacent. */
export function duplicateSlide(s: Session, index: number, position: "before" | "after" = "after") {
  const deck = S.getDeck(s);
  assertIdx(deck.slides.length, index);
  const { deck: nextDeck, newIndex: at } = duplicateSlideAt(deck, index, position); // deep clone → figure/table/code byte-identical
  s.deck = nextDeck; // survivors keep refs (uniform with delete/move; no whole-deck reparse)
  s.dirty = true;
  return { ok: true as const, changed: true as const, newIndex: at, slideCount: nextDeck.slides.length, ...tail(s) };
}
