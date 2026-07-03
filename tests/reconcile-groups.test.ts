/**
 * reconcile-groups.test.ts — Wave 3 of the adversarial-hunt fixes: reconcileEdit's handling of grouped
 * (card/step/kpi) slides.
 *  #1  a grouped slide whose edit dropped a column lost that whole card silently — the group columns
 *      (idx 1..N) were outside reconcile's structural restore set. Now restored respect-if-present
 *      (idx-keyed → still injective) and flagged by validateStructure so it's never silent.
 *  #10 a FLAT edit (cards → a plain bullet list) was force-restored back into a card because groupKind
 *      was inherited unconditionally on a dropped header. Now gated: a flattening edit keeps its flatness.
 */
import { describe, it, expect } from "vitest";
import { reconcileEdit } from "../src/engine/ai-reconcile";
import { validateStructure } from "../src/engine/ai-validate";
import { parseMd } from "../src/engine/md-parser";

const cards3 = () => parseMd("# 施策\n\n<!-- card -->\n### A\n- 本文A\n\n<!-- card -->\n### B\n- 本文B\n\n<!-- card -->\n### C\n- 顧客数12400").slides[0];

describe("#1 grouped column loss is restored + flagged (not silent)", () => {
  it("restores a dropped card column from old (respect-if-present)", () => {
    const old = cards3();
    const edited = parseMd("# 施策\n\n<!-- card -->\n### A\n- 本文A\n\n<!-- card -->\n### B\n- 本文B").slides[0]; // card C dropped
    const r = reconcileEdit(old, edited);
    const cols = r.placeholders.filter((p) => /^[1-9]$/.test(p.idx));
    expect(cols.length).toBe(3); // card C restored
    expect(JSON.stringify(r)).toContain("12400"); // its content (a fact) survived
  });

  it("does not create a duplicate idx when restoring a column (injective)", () => {
    const old = cards3();
    const edited = parseMd("# 施策\n\n<!-- card -->\n### A\n- 本文A\n\n<!-- card -->\n### B\n- 本文B").slides[0];
    const idxs = reconcileEdit(old, edited).placeholders.map((p) => p.idx);
    expect(new Set(idxs).size).toBe(idxs.length);
  });

  it("validateStructure flags the column loss (HARD for condense, SOFT for edit)", () => {
    const old = cards3();
    const edited = parseMd("# 施策\n\n<!-- card -->\n### A\n- 本文A\n\n<!-- card -->\n### B\n- 本文B").slides[0];
    expect(validateStructure(old, edited, "condense").hasHard).toBe(true);
    const v = validateStructure(old, edited, "edit");
    expect(v.ok).toBe(false); // reported (SOFT), not silent
  });
});

describe("#10 a flattening edit is respected (groupKind not force-restored)", () => {
  it("cards → a plain bullet list does NOT get card forced back on", () => {
    const old = cards3();
    const flat = parseMd("# 柱\n\n- x\n- y\n- z").slides[0]; // no groupKind, no per-column headings
    const r = reconcileEdit(old, flat);
    expect(r.groupKind).toBeUndefined(); // flatness respected
    // no phantom restored columns (idx2/idx3 from old)
    expect(r.placeholders.filter((p) => p.idx === "2" || p.idx === "3")).toHaveLength(0);
  });
});
