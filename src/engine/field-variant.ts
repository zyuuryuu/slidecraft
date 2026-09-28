/**
 * field-variant.ts — the auto pick's VARIANT PREFERENCE for field rows (#397/#398, see field-rows.ts).
 *
 * A slide carrying a `Takeaway:` / `Source:` row wants a layout that has a slot for it. The ordinary
 * pick (autoSelectLayout's role → pickLayout chain) is kept whenever it already offers the slot (e.g.
 * 公文書, whose 出典 box sits on every content layout) — only when it does NOT do we look for a variant
 * of the same role that does (Midnight `Content.1Body.Single` → `…+1Callout` / `…+1Source`). A table
 * slide tries the table family first (`Table.1Table.Single+1Source`), since that's the variant built
 * for it. No variant → the ordinary pick stands and the row is reported unbound (never-silent).
 *
 * A slot that is itself a content BODY (Midnight's Callout.Top, body ordinal 2) only counts when the
 * slide's own regions stay below it — else a figure/column would land in the same box.
 *
 * A row-less slide returns `picked` untouched → byte-identical. Pure logic (R2).
 */
import type { SlideIR } from "./slide-schema";
import { pickLayout, type CatalogEntry, type LayoutCatalog, type LayoutRole } from "./template-catalog";
import { slideFieldKinds, type FieldKind } from "./field-rows";

/** How many of `kinds` this layout can hold without its slot colliding with the slide's own regions. */
function coverage(e: CatalogEntry, kinds: readonly FieldKind[], regions: number | undefined): number {
  return kinds.filter((k) =>
    e.fieldSlots?.some((s) => s.kind === k && (s.bodyOrdinal === undefined || regions === undefined || s.bodyOrdinal > regions)),
  ).length;
}

export function preferFieldVariant(
  catalog: LayoutCatalog,
  picked: CatalogEntry | undefined,
  slide: SlideIR,
  regions: number | undefined,
  hasImage: boolean,
): CatalogEntry | undefined {
  const kinds = slideFieldKinds(slide);
  if (kinds.length === 0 || !picked) return picked;
  let winner = picked;
  let best = coverage(picked, kinds, regions);
  const roles: LayoutRole[] = slide.table && picked.role !== "table" ? ["table", picked.role] : [picked.role];
  for (const role of roles) {
    if (best === kinds.length) break;
    const cands = catalog.filter((e) => e.role === role && coverage(e, kinds, regions) > best);
    if (cands.length === 0) continue;
    const top = Math.max(...cands.map((e) => coverage(e, kinds, regions)));
    const e = pickLayout(cands.filter((c) => coverage(c, kinds, regions) === top), role, regions, hasImage);
    if (e) {
      winner = e;
      best = top;
    }
  }
  return winner;
}
