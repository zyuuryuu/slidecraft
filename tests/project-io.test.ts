/**
 * project-io.test.ts — a `.scft` bundle round-trips the full editing state
 * (deck + template) losslessly: bundle → open → same deck, working template.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { bundleProject, openProject, PROJECT_VERSION, ProjectVersionError, migrateProjectDeck } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";

let template: TemplateData;
beforeAll(async () => {
  template = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
});

describe("project-io (.scft bundle)", () => {
  const DECK_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";

  it("bundle → open restores the SAME deck (lossless, not via Markdown)", async () => {
    const deck = parseMd(DECK_MD);
    const bytes = await bundleProject(deck, template, { templateName: "Midnight Executive", savedAt: "2026-06-25T00:00:00Z" });
    const opened = await openProject(bytes);
    expect(opened.deck).toEqual(deck); // DeckIR round-trips byte-for-byte through JSON
    expect(opened.meta.templateName).toBe("Midnight Executive");
    expect(opened.meta.version).toBe(1);
  });

  it("restores a WORKING template (layouts re-parse from the bundled .pptx)", async () => {
    const deck = parseMd(DECK_MD);
    const opened = await openProject(await bundleProject(deck, template, { templateName: "T", savedAt: "x" }));
    expect(opened.template.layouts.length).toBe(template.layouts.length);
    expect(opened.template.layouts.length).toBeGreaterThan(0);
  });

  it("rejects a malformed bundle (missing deck.json / template.pptx)", async () => {
    const JSZip = (await import("jszip")).default;
    const empty = await new JSZip().generateAsync({ type: "uint8array" });
    await expect(openProject(empty)).rejects.toThrow(/scft/);
  });

  it("strips a persisted svgCache on open (F2 XSS carrier — ADR-0016)", async () => {
    // A hand-crafted deck.json can smuggle a malicious pre-rendered svgCache that reaches
    // MermaidDirect's dangerouslySetInnerHTML (and the CSP-less HTML export) WITHOUT passing
    // through mermaid's securityLevel:"strict" render. svgCache is a recomputable render
    // cache, so open MUST drop it and force a fresh, sanitized re-render.
    const base = parseMd(DECK_MD);
    const XSS = "<svg xmlns='http://www.w3.org/2000/svg'><image href='x' onerror='alert(document.domain)'/></svg>";
    const poisoned = {
      ...base,
      slides: [
        { ...base.slides[0], mermaidBlock: { mermaid: "gitGraph\n  commit", placeholderIdx: "1", svgCache: XSS } },
        ...base.slides.slice(1),
      ],
    };
    const opened = await openProject(await bundleProject(poisoned, template, { templateName: "T", savedAt: "x" }));
    for (const s of opened.deck.slides) {
      expect(s.mermaidBlock?.svgCache).toBeUndefined(); // no attacker SVG survives the load
    }
    // the mermaid SOURCE is preserved — only the render cache is dropped
    expect(opened.deck.slides[0].mermaidBlock?.mermaid).toBe("gitGraph\n  commit");
  });
});

// ── #121: meta.json.version 互換ゲート（未来 version は拒否・旧 version は移行表・同一は従来どおり） ──
/** Re-pack a valid bundle with a replaced meta.json (string = raw text; null = remove) and,
 *  optionally, a replaced deck.json (raw text). */
async function repack(bytes: Uint8Array, meta: string | null, deckJson?: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  if (meta === null) zip.remove("meta.json");
  else zip.file("meta.json", meta);
  if (deckJson !== undefined) zip.file("deck.json", deckJson);
  return zip.generateAsync({ type: "uint8array" });
}
const metaJson = (version: unknown) => JSON.stringify({ version, templateName: "T", savedAt: "x" });

describe("project-io version gate (#121)", () => {
  const MD = "# 表紙\n\n---\n\n# 中身\n\n- a";
  let valid: Uint8Array;
  beforeAll(async () => {
    valid = await bundleProject(parseMd(MD), template, { templateName: "T", savedAt: "x" });
  });

  it("bundleProject embeds v1 for a figures-less deck (#673: v2 only when a slide carries figures)", async () => {
    const zip = await JSZip.loadAsync(valid);
    expect(JSON.parse(await zip.file("meta.json")!.async("string")).version).toBe(1);
  });

  it("current version opens exactly as before (deck + meta unchanged)", async () => {
    const opened = await openProject(await repack(valid, metaJson(PROJECT_VERSION)));
    expect(opened.deck).toEqual(parseMd(MD));
    expect(opened.meta).toEqual({ version: PROJECT_VERSION, templateName: "T", savedAt: "x" });
  });

  it("a FUTURE version is rejected never-silently with code PROJECT_VERSION_TOO_NEW", async () => {
    const p = openProject(await repack(valid, metaJson(PROJECT_VERSION + 1)));
    await expect(p).rejects.toBeInstanceOf(ProjectVersionError);
    await expect(p).rejects.toMatchObject({
      code: "PROJECT_VERSION_TOO_NEW",
      fileVersion: PROJECT_VERSION + 1,
      supportedVersion: PROJECT_VERSION,
    });
    await expect(p).rejects.toThrow(/新しいバージョン.*アプリを更新/);
  });

  it("the future-version gate runs BEFORE deck.json schema validation (no cryptic zod error)", async () => {
    // A newer app may write a deck shape this build cannot parse — the user must see "update the app".
    const p = openProject(await repack(valid, metaJson(PROJECT_VERSION + 5), JSON.stringify({ futureShape: true })));
    await expect(p).rejects.toMatchObject({ code: "PROJECT_VERSION_TOO_NEW", fileVersion: PROJECT_VERSION + 5 });
  });

  it("an OLD version with no migration path is rejected explicitly (PROJECT_VERSION_UNSUPPORTED)", async () => {
    const p = openProject(await repack(valid, metaJson(0)));
    await expect(p).rejects.toBeInstanceOf(ProjectVersionError);
    await expect(p).rejects.toMatchObject({ code: "PROJECT_VERSION_UNSUPPORTED", fileVersion: 0, supportedVersion: PROJECT_VERSION });
    await expect(p).rejects.toThrow(/v0/);
  });

  it("a non-integer version is never treated as current (1.5 → too new)", async () => {
    await expect(openProject(await repack(valid, metaJson(PROJECT_VERSION + 0.5)))).rejects.toMatchObject({ code: "PROJECT_VERSION_TOO_NEW" });
  });

  it("corrupt / missing meta.json keeps the existing path (opens with default meta)", async () => {
    const defaults = { version: 0, templateName: "", savedAt: "" };
    for (const meta of ["{not json", metaJson("1"), null]) {
      const opened = await openProject(await repack(valid, meta));
      expect(opened.deck).toEqual(parseMd(MD));
      expect(opened.meta).toEqual(defaults);
    }
  });
});

describe("migrateProjectDeck (#121 migration table)", () => {
  it("same version → returns the raw deck untouched (identity)", () => {
    const raw = { slides: [] };
    expect(migrateProjectDeck(raw, 3, 3, {})).toBe(raw);
  });

  it("applies the v→v+1 steps IN ORDER up to the current version", () => {
    const table = {
      1: (d: unknown) => ({ ...(d as object), trail: [...((d as { trail?: string[] }).trail ?? []), "1→2"] }),
      2: (d: unknown) => ({ ...(d as object), trail: [...((d as { trail: string[] }).trail), "2→3"] }),
    };
    expect(migrateProjectDeck({ slides: [] }, 1, 3, table)).toEqual({ slides: [], trail: ["1→2", "2→3"] });
  });

  it("a gap in the chain throws PROJECT_VERSION_UNSUPPORTED (never a partial migration)", () => {
    const table = { 2: (d: unknown) => d };
    expect(() => migrateProjectDeck({}, 1, 3, table)).toThrow(ProjectVersionError);
    try { migrateProjectDeck({}, 1, 3, table); } catch (e) {
      expect(e).toMatchObject({ code: "PROJECT_VERSION_UNSUPPORTED", fileVersion: 1, supportedVersion: 3 });
    }
  });

  it("a newer-than-supported version throws PROJECT_VERSION_TOO_NEW", () => {
    expect(() => migrateProjectDeck({}, 4, 3, {})).toThrow(/アプリを更新/);
  });
});
