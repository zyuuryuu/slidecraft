/**
 * placeholder-binding.ts — bind a slide's content to a layout's placeholders BY ROLE (not idx).
 *
 * THE single source of truth for "which content goes in which placeholder", shared by the PPTX
 * export (placeholder-filler.buildSlideXml) AND the live preview (SlidePreview.SlideCard) so they
 * can NEVER diverge — WYSIWYG. Binding by role (via slideIdxRole/placeholderRole) is what makes an
 * ALIEN master work: the SlideIR uses canonical idxs (15=title, 1=body…) but any template's own
 * placeholder idxs bind correctly through their shared ROLE. (The old preview keyed content by
 * literal idx, so an alien master rendered blank even though the export bound it fine.)
 *
 * Scope is the TEXT route. Where a figure/table/image goes is the other half of binding and lives in
 * visual-placement.ts — the two are separate routes through the same layout, and #124 happened
 * because a guard was added to only one of them. Only `sortByIdx` is shared (that module imports it).
 *
 * Pure logic (R2): no DOM / Tauri.
 */
import type { SlideIR, PlaceholderContent, Paragraph } from "./slide-schema";
import type { PlaceholderInfo } from "./template-loader";
import { slideIdxRole, placeholderRole, type PlaceholderRole } from "./template-catalog";

/** Stable placeholder order: shorter idx first, then lexicographic (so 1 < 2 < 10 < 15). */
export function sortByIdx<T extends { idx: string }>(a: T, b: T): number {
  return a.idx.length - b.idx.length || a.idx.localeCompare(b.idx);
}

/** True when paragraphs carry no visible text — e.g. a field cleared to "" (textToParagraphs("") is
 *  a single empty-segment paragraph, not []). */
export function isBlankParagraphs(paragraphs: readonly Paragraph[]): boolean {
  return paragraphs.every((p) => p.segments.every((s) => s.text.trim() === ""));
}

/**
 * Apply one editor field edit → the new placeholder set. Upsert the content at `idx`, EXCEPT when the
 * new text is blank: then DROP the placeholder entirely (a cleared field must not persist an empty
 * paragraph placeholder in the model — export cleanliness, and it round-trips as absent). Mirrors the
 * bijection model `editByPh` (clearing removes, typing upserts). Binding already ignores empties, so
 * dropping changes only serialization/export, never routing. Pure (R2).
 */
export function applyFieldEdit(
  placeholders: readonly PlaceholderContent[],
  idx: string,
  paragraphs: Paragraph[],
): PlaceholderContent[] {
  if (isBlankParagraphs(paragraphs)) return placeholders.filter((p) => p.idx !== idx);
  const exists = placeholders.some((p) => p.idx === idx);
  return exists
    ? placeholders.map((p) => (p.idx === idx ? { ...p, paragraphs } : p))
    : [...placeholders, { idx, paragraphs }];
}

/**
 * Map each LAYOUT placeholder idx → the SlideIR content that belongs in it. Two passes:
 *
 *  Pass 1 (DIRECT idx-exact) — a template's OWN "extra" placeholders (e.g. 官公庁 cover's
 *  資料番号=idx13, メタ情報=idx14) let the user fill a design region role-binding can't name. Their
 *  content idx carries NO canonical role (slideIdxRole → "other"), so it can only have come from the
 *  user editing THAT template's own placeholder field (keyed by the real idx) — bind it straight to
 *  the same-idx layout placeholder. Auto-distilled content only ever uses canonical idxs, so this
 *  pass NEVER fires for it, and it never touches a canonical idx → alien/canonical binding is
 *  byte-identical (all handled by role in Pass 2). Without it the hand-typed text was dropped
 *  (content role "other" ≠ the placeholder's body/other role — a silent mismatch).
 *
 *  Pass 2 (ROLE) — the remaining (canonical) content binds to the remaining placeholders by ROLE
 *  (with order for repeats, e.g. columns → body#1, body#2). Any template's idx convention binds
 *  correctly (an alien master's title/body idxs match through their role).
 *
 * Returns only placeholders that received content.
 */
/**
 * Whether idx 1 means SUBTITLE (vs body) for this layout. Keyed PURELY on the LAYOUT — does it own a
 * ctrTitle placeholder (a cover)? — NOT on idx-0 content. Basing it on content was doubly wrong: it
 * flipped while editing (clearing a cover's title stranded its subtitle), and a CONTENT layout whose
 * slide-title sits at idx 0 (type "title", not ctrTitle) was misread as a cover, turning its idx-1
 * body into a subtitle and shifting every column slot. Layout-derived → stable and correct → 1:1
 * holds across edits and across content/cover layouts alike.
 */
function layoutHasCtrTitle(layoutPlaceholders: readonly PlaceholderInfo[]): boolean {
  return layoutPlaceholders.some((p) => p.type.toLowerCase().includes("ctrtitle"));
}

export function bindContentByRole(
  slide: SlideIR,
  layoutPlaceholders: readonly PlaceholderInfo[],
): Map<string, PlaceholderContent> {
  const hasCtrTitle = layoutHasCtrTitle(layoutPlaceholders);
  const out = new Map<string, PlaceholderContent>();
  const usedLayoutIdx = new Set<string>();
  const usedContent = new Set<PlaceholderContent>();

  // Pass 1 — DIRECT idx-exact bind, when unambiguous. Fires for a content idx that has a same-idx
  // layout placeholder AND either (a) its canonical role is non-semantic ("other" — a custom box the
  // user filled by hand, e.g. 資料番号=13), or (b) its role AGREES with that placeholder's role. Case
  // (b) makes REPEATED roles bind POSITIONALLY: body content "2" lands in the body placeholder at idx
  // "2" regardless of whether "1" is filled — so filling only the 2nd column no longer leaks into the
  // 1st (Pass 2's order-packing did). The role-agreement guard means it never hijacks an ALIEN layout
  // whose same idx means a different role (there agreement fails → it falls through to role-binding).
  const phByIdx = new Map(layoutPlaceholders.map((p) => [p.idx, p] as const));
  for (const c of slide.placeholders) {
    const lph = phByIdx.get(c.idx);
    if (!lph || usedLayoutIdx.has(c.idx)) continue;
    const cRole = slideIdxRole(c.idx, hasCtrTitle);
    if (cRole === "other" || placeholderRole(lph) === cRole) {
      out.set(c.idx, c);
      usedLayoutIdx.add(c.idx);
      usedContent.add(c);
    }
  }

  // Pass 2 — role-binding for the rest (unchanged when Pass 1 didn't fire).
  const contentByRole = new Map<PlaceholderRole, PlaceholderContent[]>();
  for (const c of [...slide.placeholders].sort(sortByIdx)) {
    if (usedContent.has(c)) continue;
    const role = slideIdxRole(c.idx, hasCtrTitle);
    const list = contentByRole.get(role);
    if (list) list.push(c);
    else contentByRole.set(role, [c]);
  }

  const roleSeen: Record<string, number> = {};
  for (const lph of [...layoutPlaceholders].sort(sortByIdx)) {
    if (usedLayoutIdx.has(lph.idx)) continue; // consumed by a direct bind
    const role = placeholderRole(lph);
    // DO-NO-HARM gate (master-intake.md §2 部品2): a placeholder the scorer inferred "chrome" (a thin
    // edge strip — footer/header/date/番号 band) never receives MUST-tier content (title/body/other), even
    // when its role is a mislabeled "body" (the header bug). Skip BEFORE consuming a content slot so the
    // content flows to the next REAL body (else stays unbound → surfaced by unboundContent). Healthy
    // chrome is already a meta role (not title/body) → the gate is a no-op → binding is byte-identical.
    // Only Pass 2 (automatic role-binding) is gated; Pass 1's explicit idx-exact user boxes are not.
    // "other" is listed because of #96: the ladder now resolves an untyped chrome band to "other", which
    // would otherwise move it OUT of this gate's protection — a user's custom-box content (資料番号 etc.)
    // role-binds as "other" whenever Pass-1 idx-exact can't claim it (e.g. after a layout switch) and
    // would land IN the band. Byte-identical: no corpus placeholder is chrome ∧ role "other" today.
    // The list must stay ROLE-scoped — a blanket `inferredFunction === "chrome"` skip would strip every
    // footer/date/slideNumber (341+320+282 corpus placeholders) of its legitimate meta content.
    if (lph.inferredFunction === "chrome" && (role === "title" || role === "body" || role === "other")) continue;
    roleSeen[role] = (roleSeen[role] ?? 0) + 1;
    const content = contentByRole.get(role)?.[roleSeen[role] - 1];
    if (content) out.set(lph.idx, content);
  }
  return out;
}

/** One piece of slide content that binding could not place, tagged with the ROLE it wanted. */
export interface UnboundContent {
  content: PlaceholderContent;
  role: PlaceholderRole;
}

/**
 * DO-NO-HARM / no-silent-drop (master-intake.md §2 部品2 ・ P1 可視性不変条件): the slide TEXT content
 * that bindContentByRole does NOT place into any layout placeholder — i.e. content that would be
 * SILENTLY DROPPED (more bodies than the layout offers, or a title with no title slot, e.g. the
 * mislabeled-header case inflating/starving roles). The invariant is "every content is bound OR
 * reported as unbound", so callers surface this (a MUST-tier unbound = a warning) instead of the
 * content vanishing. Blank (cleared) fields are not drops. Visuals (diagram/table/image) ride a body
 * region via their own placeholderIdx and aren't in slide.placeholders, so they're out of scope here.
 * Byte-identical to routing — it only OBSERVES bindContentByRole. Pure (R2).
 */
export function unboundContent(
  slide: SlideIR,
  layoutPlaceholders: readonly PlaceholderInfo[],
): UnboundContent[] {
  const hasCtrTitle = layoutHasCtrTitle(layoutPlaceholders);
  const bound = bindContentByRole(slide, layoutPlaceholders);
  const placed = new Set(bound.values());
  return slide.placeholders
    .filter((c) => !placed.has(c) && !isBlankParagraphs(c.paragraphs))
    .map((c) => ({ content: c, role: slideIdxRole(c.idx, hasCtrTitle) }));
}

/** A slide CONTENT item tagged with the role its (canonical) idx maps to — the content side of a bind. */
export interface ContentRef {
  idx: string; // the SlideIR content idx
  role: PlaceholderRole; // slideIdxRole(idx, hasCtrTitle)
  content: PlaceholderContent;
}

/** A LAYOUT placeholder tagged with its resolved role — the placeholder side of a bind. */
export interface PlaceholderRef {
  idx: string; // the layout placeholder idx (the box on the slide)
  role: PlaceholderRole;
}

/**
 * ADR-0030 (BindingPlan, single authority) — the OBSERVED result of binding one slide's content to a
 * layout: which content landed where (`assignments`), which content found NO home (`unbound` — the
 * no-silent-drop signal a caller turns into a warning), and which placeholders stayed empty (`unfilled`).
 * Stage A is pure OBSERVATION: nothing here re-derives routing (see resolveBinding / slideBindingPlan),
 * so `assignments` is byte-identical to what the export + preview actually write.
 */
export interface BindingPlan {
  assignments: Array<{ content: ContentRef; placeholder: PlaceholderRef }>;
  unbound: ContentRef[];
  unfilled: PlaceholderRef[];
}

/**
 * OBSERVE the role-binding of a slide onto a NON-group layout by COMPOSING the existing primitives —
 * bindContentByRole (:81, the routing) + unboundContent (:159, the drop detector) — into one BindingPlan.
 * It writes NO new routing: `assignments` is built directly from bindContentByRole's map, so binding stays
 * byte-identical (ADR-0030 stage A: the only behaviour change is that diagnostics increase). Grouped slides
 * go through slideBindingPlan (group-binding.ts), which mirrors expandGroups into this same envelope. The
 * two primitives are re-invoked rather than duplicated, so there is exactly one routing authority. Pure (R2).
 */
export function resolveBinding(
  slide: SlideIR,
  layoutPlaceholders: readonly PlaceholderInfo[],
): BindingPlan {
  const hasCtrTitle = layoutHasCtrTitle(layoutPlaceholders);
  const bound = bindContentByRole(slide, layoutPlaceholders);
  const phByIdx = new Map(layoutPlaceholders.map((p) => [p.idx, p] as const));
  const contentRef = (c: PlaceholderContent): ContentRef => ({ idx: c.idx, role: slideIdxRole(c.idx, hasCtrTitle), content: c });
  const phRef = (p: PlaceholderInfo): PlaceholderRef => ({ idx: p.idx, role: placeholderRole(p) });

  const assignments = [...bound.entries()].map(([phIdx, content]) => ({
    content: contentRef(content),
    placeholder: phRef(phByIdx.get(phIdx)!),
  }));
  const unbound = unboundContent(slide, layoutPlaceholders).map((u) => contentRef(u.content));
  // Placeholders that received no content (observational). Slide-number is auto-filled by PowerPoint, so
  // it is never "unfilled" — matching buildFieldMap's exclusion; keeps this list to REAL empty boxes.
  const filled = new Set(bound.keys());
  const unfilled = layoutPlaceholders.filter((p) => !filled.has(p.idx) && placeholderRole(p) !== "slideNumber").map(phRef);
  return { assignments, unbound, unfilled };
}


/**
 * The canonical content idx that role-binds BACK to layout placeholder `ph` — the INVERSE of
 * bindContentByRole for a single placeholder. The editor writes a field's text at THIS idx so what
 * the user types lands in exactly that placeholder (preview + export), even when the template's meta
 * idxs disagree with the canonical convention (e.g. a report cover's dt=10/ftr=11/sldNum=12, or
 * velis's 14/15/16). Content stays canonical, so render-time role-binding — and thus alien-master
 * and layout-switch robustness — is untouched.
 *
 * role "other" → the placeholder's OWN idx (Pass-1 idx-exact carries it). Meta roles are
 * single-instance (one date/footer/…), so they map to their canonical idx; body maps by ORDER
 * (1st body → "1", 2nd → "2", …) matching Pass-2's same-role ordering.
 */
export function contentIdxForPlaceholder(ph: PlaceholderInfo, hasCtrTitle: boolean): string {
  const role = placeholderRole(ph);
  // If the placeholder's OWN idx already round-trips to its role, write there (idx-exact). This is
  // the common, collision-free case: title/subtitle/body regions AND body-TYPED custom boxes
  // (資料番号=13, メタ情報=14 → slideIdxRole "other" → Pass-1 idx-exact) AND canonically-numbered
  // meta (Midnight's body@10/11/12). Only a TYPE-derived meta role whose idx disagrees with the
  // canonical convention (dt=10/ftr=11/sldNum=12, or velis 14/15/16) needs redirecting to the
  // canonical meta idx so it role-binds by TYPE — never returning "1", which on a cover (ctrTitle)
  // would read as SUBTITLE and clobber it.
  if (slideIdxRole(ph.idx, hasCtrTitle) === role) return ph.idx;
  switch (role) {
    case "title": return "15";
    case "subtitle": return hasCtrTitle ? "1" : "16";
    case "category": return "10";
    case "date": return "11";
    case "footer": return "12";
    case "slideNumber": return "50";
    default: return ph.idx; // body / other / picture / chart / table → idx-exact (Pass-1 or role carries it)
  }
}

/** One editable field: the layout placeholder it represents ⇄ the SlideIR content idx it owns. */
export interface FieldSlot {
  phIdx: string; // layout placeholder idx (the box on the slide)
  contentIdx: string; // SlideIR content idx the editor reads/writes for this field
}

/** The bijection probe's per-field marker (buildFieldMap). The sentinel is U+0000 - a code point that
 *  can NEVER appear in real user text, so a probe can't be mistaken for content.
 *
 *  Written as the ESCAPE \u0000, never as a raw NUL byte: a literal NUL makes every tool treat this
 *  file as BINARY - grep silently reports 0 matches unless you pass -a, and a naive full-file rewrite
 *  drops the byte. The escape has the identical runtime value while keeping the source plain ASCII. */
const FIELD_MARK = (i: number) => `\u0000${i}`;

/**
 * Build the editor's field map: a VERIFIED BIJECTION between a layout's editable placeholders and
 * the SlideIR content idxs, so a field can ONLY ever touch its own placeholder (no bleed) and what
 * you type shows in the box you were editing (round-trip). This is what makes placeholder ⇄ input
 * 1:1 by construction rather than by per-case heuristics.
 *
 * For each editable placeholder we assign a content idx and PROVE, by simulating bindContentByRole
 * on a marker probe, that (a) it routes to that placeholder and (b) it doesn't disturb any field
 * already assigned. Filled placeholders keep their current content; empties try the role-inverse,
 * then idx-exact, then spare body idxs — the first that keeps the whole set a bijection wins. Auto
 * slide-number placeholders are excluded (PowerPoint fills them; an editable field only misroutes).
 * Pure (R2). The field-map-bijection test asserts this invariant for every bundled template.
 */
export function buildFieldMap(
  slide: SlideIR,
  layoutPlaceholders: readonly PlaceholderInfo[],
): FieldSlot[] {
  const hasCtrTitle = layoutHasCtrTitle(layoutPlaceholders);
  const bound = bindContentByRole(slide, layoutPlaceholders);
  const editable = [...layoutPlaceholders].sort(sortByIdx).filter((p) => placeholderRole(p) !== "slideNumber");
  const used = new Set<string>();
  const chosen = new Map<string, string>(); // phIdx → contentIdx

  // Does the current assignment route EVERY chosen content idx back to its own placeholder?
  const isBijection = (): boolean => {
    const entries = [...chosen.entries()];
    const probe: SlideIR = {
      layout: slide.layout,
      placeholders: entries.map(([, cIdx], i) => ({ idx: cIdx, paragraphs: [{ segments: [{ text: FIELD_MARK(i) }] }] })),
    };
    const b = bindContentByRole(probe, layoutPlaceholders);
    return entries.every(([phIdx], i) => b.get(phIdx)?.paragraphs[0]?.segments[0]?.text === FIELD_MARK(i));
  };

  // Pass A — filled placeholders keep their existing content (already routes correctly).
  for (const ph of editable) {
    const existing = bound.get(ph.idx);
    if (existing && !used.has(existing.idx)) { chosen.set(ph.idx, existing.idx); used.add(existing.idx); }
  }
  // Pass B — empty placeholders take the first candidate that keeps the whole set a bijection.
  for (const ph of editable) {
    if (chosen.has(ph.idx)) continue;
    const candidates = [contentIdxForPlaceholder(ph, hasCtrTitle), ph.idx, "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    let pick: string | undefined;
    for (const c of candidates) {
      if (used.has(c)) continue;
      chosen.set(ph.idx, c);
      if (isBijection()) { pick = c; break; }
      chosen.delete(ph.idx);
    }
    // No content idx round-trips to this placeholder without breaking the bijection (e.g. two
    // placeholders of the same single-canonical-idx meta role, or a body box at an idx that role-binds
    // elsewhere). EXCLUDE it — never force a colliding/dropping field. It stays inherited on export;
    // it's just not directly editable in-app. This keeps the returned map a TRUE verified bijection.
    if (pick === undefined) continue;
    used.add(pick);
  }
  return editable.filter((ph) => chosen.has(ph.idx)).map((ph) => ({ phIdx: ph.idx, contentIdx: chosen.get(ph.idx)! }));
}
