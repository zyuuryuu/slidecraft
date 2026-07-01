/**
 * master-registry.test.ts — the pure name-dedup used by the master registry (Slice 1a).
 * Importing two masters with the same file name must not collide in the picker.
 */
import { describe, it, expect } from "vitest";
import { uniqueName, BUILTIN_MASTER } from "../src/components/useMasterRegistry";

describe("uniqueName (master registry display-name dedup)", () => {
  it("keeps a name that isn't taken", () => {
    expect(uniqueName("Corporate", ["Midnight Executive"])).toBe("Corporate");
  });

  it("suffixes a collision with (2), (3)…", () => {
    expect(uniqueName("Deck", ["Deck"])).toBe("Deck (2)");
    expect(uniqueName("Deck", ["Deck", "Deck (2)"])).toBe("Deck (3)");
  });

  it("trims and falls back for an empty name", () => {
    expect(uniqueName("  ", [])).toBe("テンプレート");
    expect(uniqueName("  Spaced  ", [])).toBe("Spaced");
  });

  it("the bundled sample is the default builtin entry", () => {
    expect(BUILTIN_MASTER).toMatchObject({ id: "builtin", builtin: true });
    expect(BUILTIN_MASTER.name.length).toBeGreaterThan(0);
  });
});
