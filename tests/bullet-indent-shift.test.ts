/**
 * bullet-indent-shift.test.ts — #201 Tab/Shift-Tab indent shift, written before wiring the key
 * handlers into SlideMarkdownEditor/SlideEditor (R3). Exercises the pure shiftBulletIndent helper
 * that both editors will call from their onKeyDown.
 */
import { describe, it, expect } from "vitest";
import { shiftBulletIndent } from "../src/engine/bullet-indent-shift";
import { MAX_NEST_LEVEL, indentForLevel } from "../src/engine/paragraph-nesting";

describe("#201 shiftBulletIndent: Tab indents a bullet line", () => {
  it("level 0 → level 1", () => {
    const r = shiftBulletIndent("- foo", 2, 2, false);
    expect(r?.text).toBe("  - foo");
  });

  it("cursor lands right after the new prefix when it was in the old prefix", () => {
    const r = shiftBulletIndent("- foo", 2, 2, false);
    expect(r?.selectionStart).toBe(4); // "  - foo" → index 4 = start of "foo"
    expect(r?.selectionEnd).toBe(4);
  });

  it("cursor inside the content keeps its offset from the content start", () => {
    // "- foo", cursor at 4 = between "fo" and "o"
    const r = shiftBulletIndent("- foo", 4, 4, false);
    expect(r?.text).toBe("  - foo");
    expect(r?.selectionStart).toBe(6); // "  - fo|o"
  });

  it("clamps at MAX_NEST_LEVEL (repeated Tab never grows past level 3)", () => {
    const level3 = `${indentForLevel(MAX_NEST_LEVEL)}- foo`;
    const r = shiftBulletIndent(level3, 2, 2, false);
    expect(r?.text).toBe(level3);
  });
});

describe("#201 shiftBulletIndent: Shift-Tab outdents a bullet line", () => {
  it("level 1 → level 0", () => {
    const r = shiftBulletIndent("  - foo", 4, 4, true);
    expect(r?.text).toBe("- foo");
  });

  it("clamps at level 0 (repeated Shift-Tab never goes negative)", () => {
    const r = shiftBulletIndent("- foo", 2, 2, true);
    expect(r?.text).toBe("- foo");
  });
});

describe("#201 shiftBulletIndent: non-bullet lines are left alone", () => {
  it("returns null for a plain text line", () => {
    expect(shiftBulletIndent("plain text", 3, 3, false)).toBeNull();
  });

  it("returns null for a heading line", () => {
    expect(shiftBulletIndent("### Title", 3, 3, false)).toBeNull();
  });
});

describe("#201 shiftBulletIndent: only the cursor's own line is touched", () => {
  it("leaves sibling lines byte-identical", () => {
    const text = "- a\n  - b\n- c";
    const cursor = text.indexOf("- b") + 1; // inside the second line
    const r = shiftBulletIndent(text, cursor, cursor, false);
    expect(r?.text).toBe("- a\n    - b\n- c");
  });
});

describe("#201 shiftBulletIndent: */- markers are preserved", () => {
  it("keeps a * marker on indent", () => {
    const r = shiftBulletIndent("* foo", 2, 2, false);
    expect(r?.text).toBe("  * foo");
  });
});
