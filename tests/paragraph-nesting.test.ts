/**
 * paragraph-nesting.test.ts — #103 (nested bullet lists). Pure indent↔level helpers, written
 * before the parser/serializer/ooxml/preview wiring (R3): 2/4/6 spaces → level 1/2/3, 8+ spaces
 * CLAMPS to level 3 (no-silent-drop — the content survives, just flattened to the deepest level).
 */
import { describe, it, expect } from "vitest";
import { levelFromIndent, indentForLevel, measureIndent, MAX_NEST_LEVEL } from "../src/engine/paragraph-nesting";

describe("#103 paragraph-nesting: measureIndent", () => {
  it("counts leading spaces", () => {
    expect(measureIndent("- x")).toBe(0);
    expect(measureIndent("  - x")).toBe(2);
    expect(measureIndent("    - x")).toBe(4);
    expect(measureIndent("      - x")).toBe(6);
    expect(measureIndent("        - x")).toBe(8);
  });
});

describe("#103 paragraph-nesting: levelFromIndent", () => {
  it("2/4/6 spaces → level 1/2/3", () => {
    expect(levelFromIndent(2)).toBe(1);
    expect(levelFromIndent(4)).toBe(2);
    expect(levelFromIndent(6)).toBe(3);
  });

  it("0-1 spaces → level 0 (flat)", () => {
    expect(levelFromIndent(0)).toBe(0);
    expect(levelFromIndent(1)).toBe(0);
  });

  it("8+ spaces CLAMPS to MAX_NEST_LEVEL (3) — never drops, never grows past it", () => {
    expect(levelFromIndent(8)).toBe(MAX_NEST_LEVEL);
    expect(levelFromIndent(20)).toBe(MAX_NEST_LEVEL);
  });
});

describe("#103 paragraph-nesting: indentForLevel", () => {
  it("2 spaces per level; level 0 → empty string", () => {
    expect(indentForLevel(0)).toBe("");
    expect(indentForLevel(1)).toBe("  ");
    expect(indentForLevel(2)).toBe("    ");
    expect(indentForLevel(3)).toBe("      ");
  });

  it("is the stable fixpoint of levelFromIndent (round-trip idempotence)", () => {
    for (let level = 0; level <= MAX_NEST_LEVEL; level++) {
      expect(levelFromIndent(measureIndent(indentForLevel(level) + "- x"))).toBe(level);
    }
  });
});
