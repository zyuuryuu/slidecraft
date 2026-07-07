/**
 * master-registry.test.ts — the pure name-dedup used by the master registry (Slice 1a).
 * Importing two masters with the same file name must not collide in the picker.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import { uniqueName, BUILTIN_MASTER, BUILTIN_MASTERS } from "../src/components/useMasterRegistry";

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

describe("BUILTIN_MASTERS (bundled built-in templates)", () => {
  it("bundles Midnight (default, first) plus the 3 promoted designs, with unique ids", () => {
    expect(BUILTIN_MASTERS.length).toBe(4);
    expect(BUILTIN_MASTERS[0].id).toBe("builtin"); // Midnight is the default (App's initial masterId)
    expect(BUILTIN_MASTER.id).toBe(BUILTIN_MASTERS[0].id); // the exported default == the first built-in
    const ids = BUILTIN_MASTERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    const names = BUILTIN_MASTERS.map((b) => b.name);
    expect(names).toContain("配布資料 公文書高密度");
    expect(names).toContain("ビジュアルデッキ マガジン");
    expect(names).toContain("技術報告 スタンダード水色");
  });

  it("every built-in URL points to an actual TemplateOnly file served from public/", () => {
    for (const b of BUILTIN_MASTERS) {
      expect(b.url.startsWith("/templates/slide/")).toBe(true); // served from the web root (public/)
      expect(b.url).toMatch(/TemplateOnly\.pptx$/); // content-free master, not a sample deck
      const onDisk = resolve(__dirname, "../public", b.url.replace(/^\//, ""));
      expect(existsSync(onDisk), `missing bundled template file: ${onDisk}`).toBe(true);
    }
  });
});
