/**
 * sequence-reorder.ts — Pure reorder helpers for dragging sequence participants.
 *
 * A sequence diagram's participants are columns; the meaningful canvas edit is
 * reordering them left↔right. SequenceDragOverlay wires these to pointer events
 * and commits the new node order (messages reference ids, so they follow). Kept
 * in a plain module (not the component file) so Fast Refresh stays happy.
 */

/** Count the other columns whose centre-x sits left of the cursor → the slot the
 *  dragged participant should drop into. */
export function seqDropIndex(otherCx: number[], cursorX: number): number {
  return otherCx.filter((cx) => cx < cursorX).length;
}

/** Insert `dragged` at `idx` among `others` (clamped to range). */
export function seqReorder(others: string[], dragged: string, idx: number): string[] {
  const out = others.slice();
  out.splice(Math.max(0, Math.min(idx, out.length)), 0, dragged);
  return out;
}
