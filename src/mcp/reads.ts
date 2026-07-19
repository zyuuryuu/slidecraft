/**
 * reads.ts — richer per-slide READ for the upstream AI (Theme 3, S5). get_slide bundles, in ONE call,
 * everything the AI needs to PLAN a single slide's edit: the resolved layout (which needs
 * autoSelectLayout and can't be reconstructed from bare Markdown), whether/what figure it holds, how
 * many bullets, this template's body budget + whether the slide overflows it, this slide's diagnostics,
 * and the round-trip Markdown. Pure composition of already-computed values (no schema change); split
 * out of session.ts to keep it under the 400-line cap (R1). get_slide_markdown stays the bare-Markdown
 * channel; get_slide is the STRUCTURED sibling. See docs/design/mcp-brushup.md §C.
 */
import type { Session } from "./session";
import * as S from "./session";
import { autoSelectLayout } from "../engine/template-loader";
import { serializeParagraphs } from "../engine/md-serializer-shared";
import { GuardError } from "./guard-errors";

export function getSlide(s: Session, i: number) {
  const deck = S.getDeck(s); // never-silent if no project open
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) {
    throw new GuardError(`スライド番号が範囲外です（0..${deck.slides.length - 1}）: ${i}`, "index-out-of-range");
  }
  const slide = deck.slides[i];
  const { entries: catalog, budget } = S.entriesAndBudget(s);
  // ALWAYS route through autoSelectLayout so resolvedLayout equals what actually RENDERS: a pinned name
  // absent from THIS template (alien deck) degrades to role-based re-resolution, and autoSelectLayout
  // returns a valid pinned name unchanged — so non-alien decks are byte-identical, only phantoms change.
  const resolvedLayout = autoSelectLayout(slide, i, deck.slides.length, catalog);
  const figureKind = slide.diagram ? "diagram" : slide.mermaidBlock ? "mermaid" : slide.table ? "table" : slide.code ? "code" : null;
  const issues = S.getDiagnostics(s).issues.filter((iss) => iss.slideIndex === i);
  // overBudget = this slide's TEXT body overflows the template capacity (the 'split' lever). Scoped to
  // text slides: diagnoseDeck does not diagnose overflow on a VISUAL slide (diagram/table/mermaid), so a
  // figure+notes slide's body overflow is not reflected here (matches get_deck_issues' scope).
  const overBudget = issues.some((iss) => iss.levers.includes("split"));
  const bulletCount = slide.placeholders.flatMap((p) => p.paragraphs).filter((par) => par.bullet).length;
  return {
    index: i,
    resolvedLayout,
    groupKind: slide.groupKind,
    hasFigure: figureKind !== null,
    figureKind, // 'diagram' | 'mermaid' | 'table' | 'code' | null
    bulletCount,
    budget, // this template's body capacity (maxBullets/charsPerBullet) or null
    overBudget,
    issues, // this slide's diagnostics only (levers → which fix tool)
    notes: slide.notes?.length ? serializeParagraphs(slide.notes) : null, // speaker notes (#150), plain Markdown text
    markdown: S.getSlideMarkdown(s, i), // round-trip Markdown (auto layout resolved)
  };
}
