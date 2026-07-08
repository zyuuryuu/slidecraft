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
import { masterToTemplateSpec, extractLogo, resolveFontToken } from "../src/engine/master-remake";
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

describe("theme-font token resolution (+mj-lt is a reference, not a real font)", () => {
  it("resolveFontToken maps +mj-lt/+mn-lt/+mj-ea to the theme font, passes real names through, never returns a token", () => {
    const tf = { majorLatin: "Georgia", minorLatin: "Verdana", majorEa: "游明朝", minorEa: "游ゴシック" };
    expect(resolveFontToken("+mj-lt", tf)).toBe("Georgia");
    expect(resolveFontToken("+mn-lt", tf)).toBe("Verdana");
    expect(resolveFontToken("+mj-ea", tf)).toBe("游明朝");
    expect(resolveFontToken("+mn-ea", tf)).toBe("游ゴシック");
    expect(resolveFontToken("MS Gothic", tf)).toBe("MS Gothic"); // real name unchanged
    expect(resolveFontToken("+mj-lt", {})).toBe("Arial"); // theme lacks it → safe default, never a token
    expect(resolveFontToken("+mj-lt", undefined)).toBe("Arial");
    expect(resolveFontToken("+mj-ea", { majorLatin: "Georgia" })).toBe("Georgia"); // ea falls back to latin
  });

  it("the loader extracts theme fontScheme typefaces (bundled masters font via +mj-lt)", async () => {
    const src = await loadTemplate(readFileSync(CANON));
    expect(src.themeFonts.majorLatin).toBe("Georgia"); // Midnight theme major latin
    expect(src.masterTitleStyle.fontName).toMatch(/^\+/); // master itself references the token…
  });

  it("masterToTemplateSpec resolves the token → a REAL font name (not '+mj-lt') in the re-made theme", async () => {
    const src = await loadTemplate(readFileSync(CANON));
    const spec = masterToTemplateSpec(src, { name: "T" });
    expect(spec.fonts.major).not.toMatch(/^\+/); // …but the re-made spec must carry a real font
    expect(spec.fonts.major).toBe("Georgia");
    expect(spec.fonts.minor).not.toMatch(/^\+/);
    // and the written theme therefore has a real typeface, not a broken "+mj-lt" reference
    const remade = await loadTemplate(await writeTemplate(spec));
    expect(remade.themeFonts.majorLatin).not.toMatch(/^\+/);
  });

  it("preserves the East-Asian (CJK) brand font — a JP master's 游ゴシック survives the Re-make round-trip", async () => {
    // The Japanese-locale Office default: brand font in the theme <a:ea> slot, an English pairing font in
    // <a:latin>, and the master placeholders fonting via +mj-lt/+mn-lt. Build that shape off a real load.
    const base = await loadTemplate(readFileSync(CANON));
    const jp = {
      ...base,
      themeFonts: { majorLatin: "Century Gothic", minorLatin: "Calibri", majorEa: "游ゴシック Light", minorEa: "游ゴシック" },
      masterTitleStyle: { ...base.masterTitleStyle, fontName: "+mj-lt" },
      masterBodyStyle: { ...base.masterBodyStyle, fontName: "+mn-lt" },
    };
    const spec = masterToTemplateSpec(jp, { name: "JP" });
    // the spec carries BOTH the Latin pairing AND the EA brand font (not just Latin)
    expect(spec.fonts.major).toBe("Century Gothic");
    expect(spec.fonts.majorEa).toBe("游ゴシック Light");
    expect(spec.fonts.minorEa).toBe("游ゴシック");
    // and the re-made theme round-trips the EA font — the corporate JP font is NOT lost
    const remade = await loadTemplate(await writeTemplate(spec));
    expect(remade.themeFonts.majorEa).toBe("游ゴシック Light");
    expect(remade.themeFonts.minorEa).toBe("游ゴシック");
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
