import { describe, it, expect } from "vitest";
import {
  extractThemeFromXml,
  extractedToThemeConfig,
} from "../src/engine/theme-extractor";

// Minimal OOXML theme XML for testing
const SAMPLE_THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Midnight Executive">
  <a:themeElements>
    <a:clrScheme name="MidnightExec">
      <a:dk1><a:sysClr val="windowText" lastClr="1E293B"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1E2761"/></a:dk2>
      <a:lt2><a:srgbClr val="CADCFC"/></a:lt2>
      <a:accent1><a:srgbClr val="3B82F6"/></a:accent1>
      <a:accent2><a:srgbClr val="06B6D4"/></a:accent2>
      <a:accent3><a:srgbClr val="F59E0B"/></a:accent3>
      <a:accent4><a:srgbClr val="2D3A6E"/></a:accent4>
      <a:accent5><a:srgbClr val="94A3B8"/></a:accent5>
      <a:accent6><a:srgbClr val="141B41"/></a:accent6>
      <a:hlink><a:srgbClr val="3B82F6"/></a:hlink>
      <a:folHlink><a:srgbClr val="2563EB"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="MidnightExec">
      <a:majorFont>
        <a:latin typeface="Georgia"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
      </a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

describe("extractThemeFromXml", () => {
  it("extracts theme name", () => {
    const result = extractThemeFromXml(SAMPLE_THEME_XML);
    expect(result.name).toBe("Midnight Executive");
  });

  it("extracts all color roles", () => {
    const result = extractThemeFromXml(SAMPLE_THEME_XML);
    expect(result.colors.size).toBeGreaterThanOrEqual(10);
    expect(result.colors.get("dk1")).toBe("1E293B");
    expect(result.colors.get("dk2")).toBe("1E2761");
    expect(result.colors.get("lt1")).toBe("FFFFFF");
    expect(result.colors.get("lt2")).toBe("CADCFC");
    expect(result.colors.get("accent1")).toBe("3B82F6");
    expect(result.colors.get("accent2")).toBe("06B6D4");
    expect(result.colors.get("accent3")).toBe("F59E0B");
    expect(result.colors.get("accent4")).toBe("2D3A6E");
  });

  it("extracts sysClr with lastClr", () => {
    const result = extractThemeFromXml(SAMPLE_THEME_XML);
    expect(result.colors.get("dk1")).toBe("1E293B");
    expect(result.colors.get("lt1")).toBe("FFFFFF");
  });

  it("extracts fonts", () => {
    const result = extractThemeFromXml(SAMPLE_THEME_XML);
    expect(result.fontHeading).toBe("Georgia");
    expect(result.fontBody).toBe("Calibri");
  });
});

describe("extractedToThemeConfig", () => {
  it("creates a valid ThemeConfig from extracted theme", () => {
    const extracted = extractThemeFromXml(SAMPLE_THEME_XML);
    const config = extractedToThemeConfig(extracted);

    expect(config.name).toBe("Midnight Executive");
    expect(config.palette.navy).toBe("1E2761");
    expect(config.palette.dark_navy).toBe("1E293B");
    expect(config.palette.ice_blue).toBe("CADCFC");
    expect(config.palette.accent).toBe("3B82F6");
    expect(config.palette.teal).toBe("06B6D4");
    expect(config.palette.amber).toBe("F59E0B");
    expect(config.palette.soft_navy).toBe("2D3A6E");
  });

  it("sets fonts from extracted data", () => {
    const extracted = extractThemeFromXml(SAMPLE_THEME_XML);
    const config = extractedToThemeConfig(extracted);

    expect(config.fonts.heading).toBe("Georgia");
    expect(config.fonts.body).toBe("Calibri");
  });

  it("updates diagram style colors", () => {
    const extracted = extractThemeFromXml(SAMPLE_THEME_XML);
    const config = extractedToThemeConfig(extracted);

    expect(config.diagram_style.title_font_color).toBe("#1E2761");
    expect(config.diagram_style.header_bar_color).toBe("#1E2761");
    expect(config.diagram_style.header_font_color).toBe("#FFFFFF");
    expect(config.diagram_style.header_subtitle_color).toBe("#CADCFC");
  });

  it("preserves defaults for non-extracted fields", () => {
    const extracted = extractThemeFromXml(SAMPLE_THEME_XML);
    const config = extractedToThemeConfig(extracted);

    // These should keep Midnight Executive defaults
    expect(config.diagram_style.edge_width).toBe(2.0);
    expect(config.diagram_style.group_border_width).toBe(1.5);
    expect(config.node_defaults.flowchart.process).toBeDefined();
  });
});

describe("edge cases", () => {
  it("handles minimal XML with no colors", () => {
    const minimal = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Bare"></a:theme>';
    const result = extractThemeFromXml(minimal);
    expect(result.name).toBe("Bare");
    expect(result.colors.size).toBe(0);
  });

  it("handles XML without fonts", () => {
    const noFonts = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="NoFonts">
      <a:themeElements>
        <a:clrScheme name="test">
          <a:accent1><a:srgbClr val="FF0000"/></a:accent1>
        </a:clrScheme>
      </a:themeElements>
    </a:theme>`;
    const result = extractThemeFromXml(noFonts);
    expect(result.fontHeading).toBeUndefined();
    expect(result.fontBody).toBeUndefined();
    expect(result.colors.get("accent1")).toBe("FF0000");
  });
});
