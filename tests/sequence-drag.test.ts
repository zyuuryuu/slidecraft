/**
 * sequence-drag.test.ts — Reorder logic for dragging sequence participants.
 *
 * A sequence diagram's participants are columns; the meaningful canvas edit is
 * reordering them left↔right. These pure helpers decide where a dragged
 * participant lands; the SequenceDragOverlay wires them to pointer events and
 * commits the new node order (messages reference ids, so they follow).
 */
import { describe, it, expect } from "vitest";
import { seqDropIndex, seqReorder } from "../src/components/sequence-reorder";

describe("seqDropIndex — where a dragged participant lands", () => {
  // three other columns centred at x = 1, 3, 5
  const others = [1, 3, 5];
  it("drops before all when left of the first column", () => {
    expect(seqDropIndex(others, 0.5)).toBe(0);
  });
  it("drops between columns by crossing their centres", () => {
    expect(seqDropIndex(others, 2)).toBe(1); // past col0
    expect(seqDropIndex(others, 4)).toBe(2); // past col0+col1
  });
  it("drops after all when right of the last column", () => {
    expect(seqDropIndex(others, 6)).toBe(3);
  });
});

describe("seqReorder — build the new id order", () => {
  it("inserts the dragged id at the target slot", () => {
    expect(seqReorder(["B", "C"], "A", 0)).toEqual(["A", "B", "C"]);
    expect(seqReorder(["B", "C"], "A", 1)).toEqual(["B", "A", "C"]);
    expect(seqReorder(["B", "C"], "A", 2)).toEqual(["B", "C", "A"]);
  });
  it("clamps an out-of-range index", () => {
    expect(seqReorder(["B", "C"], "A", 9)).toEqual(["B", "C", "A"]);
    expect(seqReorder(["B", "C"], "A", -1)).toEqual(["A", "B", "C"]);
  });
});
