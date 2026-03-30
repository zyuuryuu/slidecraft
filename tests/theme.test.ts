import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  midnightExecutive,
  themeFromYaml,
  themeToYaml,
  paletteHex,
  getClassdefsForType,
  paletteSummaryForPrompt,
  DEFAULT_THEME,
} from "../src/engine/theme";

describe("midnightExecutive", () => {
  it("creates a theme with correct name", () => {
    const theme = midnightExecutive();
    expect(theme.name).toBe("Midnight Executive");
  });

  it("has all 14 palette colors", () => {
    const theme = midnightExecutive();
    const keys = Object.keys(theme.palette);
    expect(keys).toHaveLength(14);
    expect(keys).toContain("navy");
    expect(keys).toContain("accent");
    expect(keys).toContain("amber");
  });

  it("has correct font defaults", () => {
    const theme = midnightExecutive();
    expect(theme.fonts.heading).toBe("Georgia");
    expect(theme.fonts.body).toBe("Calibri");
    expect(theme.fonts.mono).toBe("Consolas");
  });

  it("has flowchart, network, orgchart node defaults", () => {
    const theme = midnightExecutive();
    expect(Object.keys(theme.node_defaults.flowchart)).toContain("process");
    expect(Object.keys(theme.node_defaults.network)).toContain("server");
    expect(Object.keys(theme.node_defaults.orgchart)).toContain("ceo");
  });
});

describe("DEFAULT_THEME", () => {
  it("is a Midnight Executive instance", () => {
    expect(DEFAULT_THEME.name).toBe("Midnight Executive");
  });
});

describe("paletteHex", () => {
  it("returns #RRGGBB format", () => {
    const theme = midnightExecutive();
    expect(paletteHex(theme.palette, "navy")).toBe("#1E2761");
    expect(paletteHex(theme.palette, "accent")).toBe("#3B82F6");
  });
});

describe("themeToYaml / themeFromYaml roundtrip", () => {
  it("roundtrips correctly", () => {
    const original = midnightExecutive();
    const yamlStr = themeToYaml(original);
    const restored = themeFromYaml(yamlStr);

    expect(restored.name).toBe(original.name);
    expect(restored.palette).toEqual(original.palette);
    expect(restored.fonts).toEqual(original.fonts);
    expect(restored.diagram_style).toEqual(original.diagram_style);
    expect(restored.node_defaults.flowchart).toEqual(original.node_defaults.flowchart);
  });
});

describe("themeFromYaml", () => {
  it("returns default for empty YAML", () => {
    const theme = themeFromYaml("");
    expect(theme.name).toBe("Midnight Executive");
  });

  it("throws for non-mapping root", () => {
    expect(() => themeFromYaml("- item1\n- item2")).toThrow("mapping");
  });

  it("merges partial palette override", () => {
    const yamlStr = `
name: Custom Theme
palette:
  navy: "FF0000"
`;
    const theme = themeFromYaml(yamlStr);
    expect(theme.name).toBe("Custom Theme");
    expect(theme.palette.navy).toBe("FF0000");
    // Other colors unchanged
    expect(theme.palette.accent).toBe("3B82F6");
  });

  it("merges partial node_defaults", () => {
    const yamlStr = `
node_defaults:
  flowchart:
    custom_role:
      fill: "#FF0000"
      font_color: "#000000"
`;
    const theme = themeFromYaml(yamlStr);
    // Original roles preserved
    expect(theme.node_defaults.flowchart.process).toBeDefined();
    // Custom role added
    expect(theme.node_defaults.flowchart.custom_role).toEqual({
      fill: "#FF0000",
      font_color: "#000000",
    });
  });

  it("ignores unknown top-level fields", () => {
    const yamlStr = `
name: Test
unknown_field: true
`;
    const theme = themeFromYaml(yamlStr);
    expect(theme.name).toBe("Test");
  });

  it("loads the bundled midnight_executive.yaml", () => {
    const yamlPath = resolve(__dirname, "../themes/midnight_executive.yaml");
    const yamlStr = readFileSync(yamlPath, "utf-8");
    const theme = themeFromYaml(yamlStr);
    expect(theme.name).toBe("Midnight Executive");
    expect(theme.palette.navy).toBe("1E2761");
  });
});

describe("getClassdefsForType", () => {
  it("returns flowchart classDefs", () => {
    const defs = getClassdefsForType(DEFAULT_THEME, "flowchart");
    expect(defs.terminal).toBeDefined();
    expect(defs.process).toBeDefined();
  });

  it("returns network classDefs", () => {
    const defs = getClassdefsForType(DEFAULT_THEME, "network");
    expect(defs.server).toBeDefined();
  });

  it("falls back to flowchart for unknown type", () => {
    const defs = getClassdefsForType(DEFAULT_THEME, "unknown");
    expect(defs).toEqual(DEFAULT_THEME.node_defaults.flowchart);
  });
});

describe("paletteSummaryForPrompt", () => {
  it("returns formatted string with palette colors", () => {
    const summary = paletteSummaryForPrompt(DEFAULT_THEME);
    expect(summary).toContain("#1E2761");
    expect(summary).toContain("navy");
    expect(summary).toContain("accent");
  });
});
