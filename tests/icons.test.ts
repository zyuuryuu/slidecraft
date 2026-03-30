import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  svgToPng,
  resolveIconPath,
  getIconPngData,
  getIconBase64,
  listBuiltinIcons,
  clearCache,
} from "../src/engine/icons";

const ICONS_DIR = resolve(__dirname, "../icons");

beforeEach(() => {
  clearCache();
});

describe("resolveIconPath", () => {
  it("resolves built-in icon names", () => {
    const path = resolveIconPath("router");
    expect(path).toBeDefined();
    expect(path!.endsWith("router.svg")).toBe(true);
  });

  it("resolves multiple built-in icons", () => {
    for (const name of ["server", "database", "cloud", "firewall"]) {
      const path = resolveIconPath(name);
      expect(path).toBeDefined();
    }
  });

  it("returns undefined for unknown icon names", () => {
    expect(resolveIconPath("nonexistent_icon")).toBeUndefined();
  });

  it("returns undefined for non-image file paths", () => {
    expect(resolveIconPath("/tmp/test.txt")).toBeUndefined();
  });
});

describe("svgToPng", () => {
  it("converts SVG string to PNG buffer", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
    const png = svgToPng(svg, 64);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // P
    expect(png[2]).toBe(0x4e); // N
    expect(png[3]).toBe(0x47); // G
  });

  it("converts built-in SVG icon to PNG", () => {
    const svgPath = resolve(ICONS_DIR, "router.svg");
    const svgData = readFileSync(svgPath, "utf-8");
    const png = svgToPng(svgData, 128);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
  });
});

describe("getIconPngData", () => {
  it("returns PNG data for built-in icon", () => {
    const data = getIconPngData("router");
    expect(data).toBeDefined();
    expect(data).toBeInstanceOf(Uint8Array);
    // PNG magic bytes
    expect(data![0]).toBe(0x89);
    expect(data![1]).toBe(0x50);
  });

  it("returns undefined for unknown icon", () => {
    expect(getIconPngData("nonexistent")).toBeUndefined();
  });

  it("caches results (second call returns same data)", () => {
    const data1 = getIconPngData("server");
    const data2 = getIconPngData("server");
    expect(data1).toBe(data2); // same reference (cached)
  });

  it("works with custom size", () => {
    const small = getIconPngData("database", 32);
    clearCache();
    const large = getIconPngData("database", 256);
    expect(small).toBeDefined();
    expect(large).toBeDefined();
    // Larger render should produce larger file
    expect(large!.length).toBeGreaterThan(small!.length);
  });
});

describe("getIconBase64", () => {
  it("returns base64 data URI for built-in icon", () => {
    const b64 = getIconBase64("cloud");
    expect(b64).toBeDefined();
    expect(b64!.startsWith("image/png;base64,")).toBe(true);
  });

  it("returns undefined for unknown icon", () => {
    expect(getIconBase64("nonexistent")).toBeUndefined();
  });
});

describe("listBuiltinIcons", () => {
  it("returns available icons sorted", () => {
    const icons = listBuiltinIcons();
    expect(icons.length).toBeGreaterThan(0);
    // Should be sorted
    const sorted = [...icons].sort();
    expect(icons).toEqual(sorted);
  });

  it("includes known icons", () => {
    const icons = listBuiltinIcons();
    expect(icons).toContain("router");
    expect(icons).toContain("server");
    expect(icons).toContain("database");
  });
});
