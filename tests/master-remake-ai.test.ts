/**
 * Phase-0 AI Re-make (option C: structure mapping) — the DETERMINISTIC harness. The AI's raw text is
 * fed in; here we prove: the vocabulary is the canonical set, the source inventory extracts, a valid
 * mapping composes canonical layouts, and ANY broken/hallucinated/empty AI response falls back to the
 * deterministic Re-make (never worse). No model is called here (see scripts for the Ollama spike).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { loadTemplate } from "../src/engine/template-loader";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import {
  remakeVocabulary, masterToLayoutInventory, remakeSystemPrompt,
  parseRemakeMapping, composeRemakeLayouts, aiRemakeSpec, pickBestRawMapping,
} from "../src/engine/master-remake-ai";

const load = (p: string) => loadTemplate(new Uint8Array(readFileSync(p)));
const MIDNIGHT = "public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx";

describe("AI Re-make Phase-0: vocabulary + inventory (deterministic input)", () => {
  it("vocabulary is exactly the canonical BUILTIN_LAYOUTS with roles", () => {
    const v = remakeVocabulary();
    expect(v.length).toBe(BUILTIN_LAYOUTS.length);
    expect(new Set(v.map((e) => e.name))).toEqual(new Set(BUILTIN_LAYOUTS.map((l) => l.name)));
    expect(v.find((e) => e.name === "Column.2Body.Equal")).toMatchObject({ role: "columns", family: "light" });
    expect(v.find((e) => e.name === "Title.1Title.Single")).toMatchObject({ role: "title", family: "dark" });
  });

  it("extracts a per-source-layout summary with roles + a prompt that names the source layouts", async () => {
    const tpl = await load(MIDNIGHT);
    const inv = masterToLayoutInventory(tpl);
    expect(inv.length).toBe(tpl.layouts.length);
    expect(inv.every((s) => typeof s.role === "string" && Array.isArray(s.phs))).toBe(true);
    const prompt = remakeSystemPrompt(inv);
    expect(prompt).toContain("Canonical layouts");
    expect(prompt).toContain(inv[0].name); // the source layout is offered to the model
  });
});

describe("AI Re-make Phase-0: mapping parse (hallucination guard)", () => {
  it("accepts a valid mapping and drops entries whose base isn't canonical", () => {
    const raw = JSON.stringify({ layouts: [
      { base: "Title.1Title.Single", rename: "00_表紙" },
      { base: "Column.2Body.Equal", rename: "比較" },
      { base: "Totally.Made.Up", rename: "x" }, // hallucination → dropped
    ] });
    const r = parseRemakeMapping(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layouts.map((l) => l.base)).toEqual(["Title.1Title.Single", "Column.2Body.Equal"]);
      expect(r.dropped).toBe(1);
      expect(r.layouts[0].rename).toBe("00_表紙");
    }
  });

  it("tolerates prose/code-fence wrapping (parseJsonLoose)", () => {
    const raw = "Sure!\n```json\n{ \"layouts\": [ { \"base\": \"Content.1Body.Single\" } ] }\n```";
    const r = parseRemakeMapping(raw);
    expect(r.ok).toBe(true);
  });

  it("fails cleanly on non-JSON, missing array, or all-hallucinated bases", () => {
    expect(parseRemakeMapping("no json here").ok).toBe(false);
    expect(parseRemakeMapping(JSON.stringify({ nope: 1 })).ok).toBe(false);
    expect(parseRemakeMapping(JSON.stringify({ layouts: [{ base: "Nope.1" }] })).ok).toBe(false);
  });
});

describe("AI Re-make Phase-0: compose + deterministic fallback (harness over model)", () => {
  it("composes by NAME: keeps each distinctly-named source layout, even on the SAME canonical base", () => {
    const layouts = composeRemakeLayouts([
      { base: "SectionNav.1Title.Single", rename: "Segue白" },
      { base: "SectionNav.1Title.Single", rename: "Segue紺" }, // same base, different name → KEPT
      { base: "Content.1Body.Single", rename: "本文" },
    ]);
    expect(layouts.map((l) => l.name)).toEqual(["Segue白", "Segue紺", "本文"]);
    // both Segue layouts share the canonical SectionNav geometry (AI picks the base; geometry is deterministic)
    const sectionBase = BUILTIN_LAYOUTS.find((l) => l.name === "SectionNav.1Title.Single")!;
    expect(layouts[0].placeholders).toEqual(sectionBase.placeholders);
    expect(layouts[1].placeholders).toEqual(sectionBase.placeholders);
  });

  it("dedups only a genuine NAME collision (same resulting name)", () => {
    const layouts = composeRemakeLayouts([
      { base: "Title.1Title.Single", rename: "同名" },
      { base: "Content.1Body.Single", rename: "同名" }, // same NAME → dedup (keep first)
      { base: "Content.1Body.Single" }, // no rename → name = base → distinct → kept
    ]);
    expect(layouts.map((l) => l.name)).toEqual(["同名", "Content.1Body.Single"]);
  });

  it("aiRemakeSpec: a valid AI response yields theme + AI-selected layouts", async () => {
    const tpl = await load(MIDNIGHT);
    const raw = JSON.stringify({ layouts: [{ base: "Title.1Title.Single", rename: "表紙" }, { base: "Content.1Body.Single", rename: "本文" }] });
    const { spec, usedAi } = aiRemakeSpec(tpl, raw, { name: "T" });
    expect(usedAi).toBe(true);
    expect(spec.layouts?.map((l) => l.name)).toEqual(["表紙", "本文"]);
    expect(spec.fonts).toBeTruthy(); // theme is the deterministic extraction
    expect(spec.palette).toBeTruthy();
  });

  it("aiRemakeSpec: broken / empty / all-hallucinated AI → deterministic Re-make (theme only, no layouts)", async () => {
    const tpl = await load(MIDNIGHT);
    for (const raw of [null, "garbage", JSON.stringify({ layouts: [{ base: "X.1" }] })]) {
      const { spec, usedAi } = aiRemakeSpec(tpl, raw as string | null);
      expect(usedAi).toBe(false);
      expect(spec.layouts).toBeUndefined(); // falls back to the built-in 30
      expect(spec.fonts).toBeTruthy();
    }
  });
});

describe("AI Re-make Phase-2: rationale (explainability) + best-of-N", () => {
  it("parseRemakeMapping captures a per-entry `reason` (trimmed, capped)", () => {
    const raw = JSON.stringify({ layouts: [
      { base: "Title.1Title.Single", rename: "表紙", reason: "  cover: single centred title  " },
      { base: "Content.1Body.Single", rename: "本文" }, // no reason → undefined, still valid
      { base: "Column.2Body.Equal", rename: "比較", reason: 42 }, // non-string → ignored
    ] });
    const r = parseRemakeMapping(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layouts[0].reason).toBe("cover: single centred title");
      expect(r.layouts[1].reason).toBeUndefined();
      expect(r.layouts[2].reason).toBeUndefined();
    }
  });

  it("aiRemakeSpec surfaces the AI decisions (base + reason) via `mappings` for a valid response", async () => {
    const tpl = await load(MIDNIGHT);
    const raw = JSON.stringify({ layouts: [{ base: "Title.1Title.Single", rename: "表紙", reason: "cover" }] });
    const { usedAi, mappings } = aiRemakeSpec(tpl, raw, { name: "T" });
    expect(usedAi).toBe(true);
    expect(mappings).toEqual([{ base: "Title.1Title.Single", rename: "表紙", reason: "cover" }]);
  });

  it("aiRemakeSpec omits `mappings` on the deterministic fallback", async () => {
    const tpl = await load(MIDNIGHT);
    const { usedAi, mappings } = aiRemakeSpec(tpl, "garbage");
    expect(usedAi).toBe(false);
    expect(mappings).toBeUndefined();
  });

  it("pickBestRawMapping picks the response covering the MOST source layouts", () => {
    const thin = JSON.stringify({ layouts: [{ base: "Title.1Title.Single" }] });
    const rich = JSON.stringify({ layouts: [
      { base: "Title.1Title.Single" }, { base: "Content.1Body.Single" }, { base: "Column.2Body.Equal" },
    ] });
    expect(pickBestRawMapping([thin, rich])).toBe(rich);
    expect(pickBestRawMapping([rich, thin])).toBe(rich);
  });

  it("pickBestRawMapping tie-breaks on FEWEST hallucinated drops", () => {
    const clean = JSON.stringify({ layouts: [{ base: "Title.1Title.Single" }, { base: "Content.1Body.Single" }] });
    const dirty = JSON.stringify({ layouts: [
      { base: "Title.1Title.Single" }, { base: "Content.1Body.Single" }, { base: "Made.Up" }, { base: "Also.Fake" },
    ] }); // same 2 usable, but 2 dropped
    expect(pickBestRawMapping([dirty, clean])).toBe(clean);
  });

  it("pickBestRawMapping skips null/garbage and returns null when none parse", () => {
    const good = JSON.stringify({ layouts: [{ base: "Content.1Body.Single" }] });
    expect(pickBestRawMapping([null, "not json", undefined, good])).toBe(good);
    expect(pickBestRawMapping([null, "nope", JSON.stringify({ layouts: [{ base: "Fake.1" }] })])).toBeNull();
    expect(pickBestRawMapping([])).toBeNull();
  });

  it("remakeSystemPrompt asks for a reason field", async () => {
    const tpl = await load(MIDNIGHT);
    const prompt = remakeSystemPrompt(masterToLayoutInventory(tpl));
    expect(prompt).toContain('"reason"');
  });
});
