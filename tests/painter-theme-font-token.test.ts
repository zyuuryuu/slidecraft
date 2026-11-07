/**
 * painter-theme-font-token.test.ts — #532: a master placeholder fonted via a theme fontScheme
 * reference (`<a:latin typeface="+mn-lt"/>`) keeps the RAW token in TemplateData by contract
 * (template-loader). The painter (SlideCard → preview / HTML export / get_slide_image) must resolve
 * it to the theme's real typeface via the ONE resolver (master-remake.resolveFontToken, R8) before
 * building the CSS font-family — otherwise Latin runs drop the brand font for the next fallback.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSession, newProject, type Session } from "../src/mcp/session";
import { renderSlideHtml } from "../src/mcp/slide-raster";
import { renderDeckToHtml } from "../src/components/deck-html-export";
import { loadTemplate } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";

const TEMPLATE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const MD = "# 四半期経営レビュー\n> 経営企画部\n\n---\n\n# 現状分析\n\n- Revenue grew 20% YoY\n- 新規顧客が32社増加";

let templateBytes: Uint8Array;
beforeAll(() => {
  templateBytes = new Uint8Array(readFileSync(TEMPLATE));
});

async function loadedSession(): Promise<Session> {
  const s = createSession(null);
  await newProject(s, templateBytes, MD);
  return s;
}

/** Every inline `font-family:` value in the SSR'd markup (style attributes, HTML-escaped quotes). */
function fontFamilies(html: string): string[] {
  return [...html.matchAll(/font-family:([^;"]*(?:&quot;[^;"]*)*)/g)].map((m) => m[1]!.replace(/&quot;/g, '"').trim());
}

describe("#532 painter resolves theme font tokens (Midnight: minorLatin=Calibri, majorLatin=Georgia)", () => {
  it("the fixture really carries the tokens on its master styles (precondition, raw by contract)", async () => {
    const s = await loadedSession();
    const t = s.template!;
    expect(t.masterBodyStyle.fontName).toBe("+mn-lt");
    expect(t.themeFonts.minorLatin).toBe("Calibri");
    expect(t.themeFonts.majorLatin).toBe("Georgia");
  });

  it("renderSlideHtml emits no +m… token in any font-family", async () => {
    const s = await loadedSession();
    for (const i of [0, 1]) {
      const html = renderSlideHtml(s, i);
      expect(html).not.toMatch(/\+m[nj]-(lt|ea)/);
    }
  });

  it("the body text's font-family leads with the theme's minorLatin", async () => {
    const s = await loadedSession();
    const html = renderSlideHtml(s, 1);
    const body = fontFamilies(html).filter((f) => !f.startsWith("ui-monospace"));
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((f) => f.split(",")[0]!.trim().replace(/"/g, "") === "Calibri")).toBe(true);
  });

  it("the standalone HTML export (renderDeckToHtml — a separate SlideCard caller) resolves too", async () => {
    const tpl = await loadTemplate(readFileSync(TEMPLATE));
    const html = await renderDeckToHtml(parseMd(MD), tpl);
    expect(html).not.toMatch(/\+m[nj]-(lt|ea)/);
    expect(fontFamilies(html).some((f) => f.split(",")[0]!.trim().replace(/"/g, "") === "Calibri")).toBe(true);
  });
});
