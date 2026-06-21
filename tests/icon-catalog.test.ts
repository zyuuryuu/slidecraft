/**
 * icon-catalog.test.ts — The single icon registry feeding render / AI / validation.
 * ① one source (BUILTIN_ICONS derives from it)  ② prompt + validation  ③ alias normalize.
 */
import { describe, it, expect } from "vitest";
import { ICON_NAMES, normalizeIconName, iconCatalogPromptList, ICON_CATALOG } from "../src/engine/icon-catalog";
import { BUILTIN_ICONS, DiagramSpecSchema } from "../src/engine/schema";
import { diagnoseJson } from "../src/engine/schema-diagnostics";
import { diagramSystemPrompt } from "../src/engine/llm-prompts";
import { renderDiagramToSvg } from "../src/engine/svg-writer";

describe("① single source of truth", () => {
  it("BUILTIN_ICONS is exactly the catalog keys (no second list to drift)", () => {
    expect([...BUILTIN_ICONS].sort()).toEqual([...ICON_NAMES].sort());
    expect(ICON_NAMES).toHaveLength(15);
  });
  it("no alias collides with a different canonical name", () => {
    const seen = new Map<string, string>();
    for (const [name, info] of Object.entries(ICON_CATALOG))
      for (const a of info.aliases) {
        expect(seen.has(a)).toBe(false); // each alias is unique
        expect(ICON_NAMES.includes(a)).toBe(false); // an alias is never itself a canonical name
        seen.set(a, name);
      }
  });
});

describe("③ alias / loose-casing normalization", () => {
  it("resolves exact names, aliases, and messy casing/spacing", () => {
    expect(normalizeIconName("database")).toBe("database"); // exact
    expect(normalizeIconName("db")).toBe("database"); // alias
    expect(normalizeIconName("DB")).toBe("database"); // case
    expect(normalizeIconName("Load Balancer")).toBe("load_balancer"); // space → underscore
    expect(normalizeIconName("load-balancer")).toBe("load_balancer"); // hyphen
    expect(normalizeIconName("LB")).toBe("load_balancer");
    expect(normalizeIconName("wifi")).toBe("wireless_ap");
    expect(normalizeIconName("fw")).toBe("firewall");
  });
  it("returns undefined for unknown / empty", () => {
    expect(normalizeIconName("zzz")).toBeUndefined();
    expect(normalizeIconName("")).toBeUndefined();
    expect(normalizeIconName(undefined)).toBeUndefined();
  });
  it("a node authored with an ALIAS renders its glyph (db → database cylinder)", () => {
    const spec = DiagramSpecSchema.parse({ type: "network", direction: "LR", nodes: [{ id: "a", label: "Store", icon: "db" }], edges: [] });
    expect((renderDiagramToSvg(spec, {}).match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("② AI prompt + validation feedback", () => {
  it("the diagram system prompt teaches the icon field + the catalog", () => {
    const p = diagramSystemPrompt();
    expect(p).toContain('"icon"');
    expect(p).toContain("Available Icons");
    for (const name of ["server", "database", "load_balancer", "firewall"]) expect(p).toContain(name);
    expect(iconCatalogPromptList()).toContain("server — ");
  });
  it("validateions: unknown icon warns (with a hint); valid name + alias do not", () => {
    const warn = (icon: string) =>
      diagnoseJson(JSON.stringify({ type: "flowchart", nodes: [{ id: "a", label: "A", icon }] }))
        .filter((d) => d.path === "nodes[0].icon");
    expect(warn("databse")[0]?.message).toMatch(/database/); // typo → suggests 'database'
    expect(warn("databse")[0]?.level).toBe("warning"); // a warning, NOT a fatal error
    expect(warn("server")).toHaveLength(0); // canonical → clean
    expect(warn("lb")).toHaveLength(0); // alias → clean (normalizes)
  });
});
