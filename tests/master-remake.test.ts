/**
 * master-remake.test.ts — the "Re-make" intake mode: extract a company master's theme (fonts + colors)
 * and re-emit SlideCraft's canonical layouts wearing it. Coexists with faithful Import. Proves the
 * round-trip (extract → writeTemplate → loadTemplate) yields a HEALTHY, contrast-safe template that
 * fills content — dissolving the third-party idx/contrast quirks from ADR-0023 by construction.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { masterToTemplateSpec, extractLogo } from "../src/engine/master-remake";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { buildCatalog, assessTemplateHealth } from "../src/engine/template-catalog";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";
import { luminance } from "../src/engine/ooxml-resolve";

const CX = resolve(__dirname, "fixtures/templates/CX_sample_MSGothic.pptx");
// CX Sample is a LOCAL-ONLY, IP-stripped company template (gitignored) — skip when absent (CI).
const HAS_CX = existsSync(CX);
const CANON = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const contrast = (a: string, b: string) => Math.abs(luminance(a) - luminance(b));

// CI-covered path using a TRACKED master (canonical), so Re-make is verified without the CX fixture.
describe("Re-make round-trip on a bundled master (CI-covered)", () => {
  it("extracts fonts + a contrast-safe palette and mints a healthy template", async () => {
    const src = await loadTemplate(readFileSync(CANON));
    const spec = masterToTemplateSpec(src, { name: "Canon Re-make" });
    expect(spec.fonts.major).toBeTruthy();
    expect(contrast(spec.palette.titleText, spec.palette.background)).toBeGreaterThan(0.3);
    expect(contrast(spec.palette.bodyText, spec.palette.canvas)).toBeGreaterThan(0.3);
    const remade = await loadTemplate(await writeTemplate(spec));
    expect(assessTemplateHealth(buildCatalog(remade)).status).not.toBe("rejected");
  });
});

// A minimal valid 1×1 PNG — lets the logo path be CI-covered without the CX fixture.
const TINY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
);

describe("logo injection + extraction (CI-covered, synthetic png)", () => {
  it("writeTemplate embeds the logo on dark layouts, and loadTemplate surfaces it as a data-URI image", async () => {
    const bytes = await writeTemplate({
      name: "T",
      fonts: { major: "Arial", minor: "Arial" },
      palette: MIDNIGHT_PALETTE,
      logo: { bytes: TINY_PNG, ext: "png", aspect: 3 },
    });
    const remade = await loadTemplate(bytes);
    const withLogo = remade.layouts.filter((l) => l.images.length > 0);
    expect(withLogo.length).toBeGreaterThan(0); // dark-family layouts (cover/section/closing) get it
    expect(withLogo[0].images[0].src).toMatch(/^data:image\/png;base64,/); // preview-paintable, self-contained
  });
});

describe("flatContent — absorb a flat source design (CI-covered)", () => {
  const lightLayoutXml = async (flatContent: boolean) => {
    const zip = await JSZip.loadAsync(
      await writeTemplate({ name: "T", fonts: { major: "Arial", minor: "Arial" }, palette: MIDNIGHT_PALETTE, flatContent }),
    );
    for (const f of Object.keys(zip.files).filter((n) => /slideLayout\d+\.xml$/.test(n))) {
      const x = (await zip.file(f)!.async("string")) as string;
      if (/name="Content\.1Body\.Single"/.test(x)) return x;
    }
    return "";
  };
  it("flatContent removes the header-bar deco on light layouts; default keeps it", async () => {
    // The header bar is the light content layout's only decorative shape (name="Deco…"). Flat drops
    // it → clean white content slide (title recolored to a dark ink so it still reads on canvas).
    expect(await lightLayoutXml(true)).not.toMatch(/name="Deco/);
    expect(await lightLayoutXml(false)).toMatch(/name="Deco/);
  });
});

describe.skipIf(!HAS_CX)("logo inheritance from a real master", () => {
  it("extractLogo lifts the source's raster logo", async () => {
    const logo = await extractLogo(await loadTemplate(readFileSync(CX)));
    expect(logo?.ext).toBe("png");
    expect(logo!.bytes.length).toBeGreaterThan(100);
  });
  it("faithful CX import now surfaces its layout logos to the preview (was dropped before)", async () => {
    const cx = await loadTemplate(readFileSync(CX));
    expect(cx.layouts.some((l) => l.images.length > 0)).toBe(true);
  });
});

describe.skipIf(!HAS_CX)("masterToTemplateSpec — extract theme from a real master", () => {
  let cx: TemplateData;
  beforeAll(async () => {
    cx = await loadTemplate(readFileSync(CX));
  });

  it("carries the company's fonts", () => {
    const spec = masterToTemplateSpec(cx);
    expect(spec.fonts.major).toMatch(/gothic/i); // CX is MS Gothic
    expect(spec.fonts.minor).toMatch(/gothic/i);
  });

  it("maps a light canvas + a dark brand background", () => {
    const spec = masterToTemplateSpec(cx);
    expect(spec.palette.canvas).toBe("FFFFFF"); // CX's real master bg (inverted theme handled)
    expect(luminance(spec.palette.background)).toBeLessThan(0.5); // a dark brand color for dark layouts
  });

  it("detects CX's FLAT content design (dark title on a light canvas)", () => {
    expect(masterToTemplateSpec(cx).flatContent).toBe(true);
  });

  it("maps colors CONTRAST-SAFELY (no invisible text by construction)", () => {
    const p = masterToTemplateSpec(cx).palette;
    expect(contrast(p.titleText, p.background)).toBeGreaterThan(0.3); // title on dark header/bg
    expect(contrast(p.bodyText, p.canvas)).toBeGreaterThan(0.3); // body on the light canvas
    expect(contrast(p.emphasis, p.canvas)).toBeGreaterThan(0.2); // emphasis on the canvas
    expect(contrast(p.subtle, p.background)).toBeGreaterThan(0.2); // subtitle on the dark bg
  });
});

describe.skipIf(!HAS_CX)("Re-make round-trip — the minted template is healthy + fills content", () => {
  let remade: TemplateData;
  beforeAll(async () => {
    const cx = await loadTemplate(readFileSync(CX));
    const bytes = await writeTemplate(masterToTemplateSpec(cx, { name: "CX Re-make" }));
    remade = await loadTemplate(bytes);
  });

  it("passes the acceptance gate (not rejected)", () => {
    const health = assessTemplateHealth(buildCatalog(remade));
    expect(health.status).not.toBe("rejected");
  });

  it("uses SlideCraft's canonical convention (dotted names) — no idx ambiguity", () => {
    // The re-made template IS canonical, so its content body sits at idx 1 (well-controlled).
    expect(remade.layouts.some((l) => /\.\d/.test(l.name))).toBe(true);
  });

  it("END-TO-END: a content deck fills + renders on the re-made template", async () => {
    const deck = parseMd("# 事業計画\n## レビュー\n\n---\n\n# 今期の柱\n\n- 品質を上げる\n- 速度を上げる\n");
    const buf = await generatePptx(deck, remade);
    const zip = await JSZip.loadAsync(buf);
    const s2 = (await zip.file("ppt/slides/slide2.xml")?.async("string")) ?? "";
    expect(s2).toContain("今期の柱");
    expect(s2).toContain("品質を上げる");
  });
});
