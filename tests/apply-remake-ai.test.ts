/**
 * applyTemplateBytesAsRemakeAI — the AI Re-make apply path (ADR-0026). The AI provider is INJECTED as
 * `callAI`, so this is unit-tested with no model: a valid mapping is used; null / thrown / garbage /
 * all-hallucinated responses fall back to the deterministic Re-make (never worse), and the result is
 * always a healthy, applied template.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { applyTemplateBytesAsRemakeAI } from "../src/components/apply-template";
import type { TemplateData } from "../src/engine/template-loader";

const SRC = new Uint8Array(readFileSync("public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"));
const makeSetters = () => {
  let td: TemplateData | undefined;
  return {
    setters: {
      setTemplateData: (t: TemplateData) => { td = t; },
      setTemplateName: vi.fn(),
      setParseError: vi.fn(),
    },
    applied: () => td,
  };
};

describe("applyTemplateBytesAsRemakeAI", () => {
  it("uses a valid AI mapping → the applied template has the AI-selected, source-named layouts", async () => {
    const { setters, applied } = makeSetters();
    const mapping = JSON.stringify({ layouts: [
      { base: "Title.1Title.Single", rename: "表紙" },
      { base: "Content.1Body.Single", rename: "本文" },
      { base: "Closing.1Message.Single", rename: "締め" },
    ] });
    const callAI = vi.fn(async () => mapping);
    const r = await applyTemplateBytesAsRemakeAI(SRC, "会社.pptx", setters, callAI);
    expect(r.ok).toBe(true);
    expect(r.usedAi).toBe(true);
    expect(callAI).toHaveBeenCalledOnce();
    const names = applied()!.layouts.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(["表紙", "本文", "締め"]));
    expect(applied()!.layouts.length).toBe(3); // only the mapped set, not the built-in 30
    expect(setters.setParseError).not.toHaveBeenCalledWith(expect.stringMatching(/failed/i));
  });

  it("null AI response → deterministic Re-make fallback (built-in layouts, still ok)", async () => {
    const { setters, applied } = makeSetters();
    const r = await applyTemplateBytesAsRemakeAI(SRC, "会社.pptx", setters, async () => null);
    expect(r.ok).toBe(true);
    expect(r.usedAi).toBe(false);
    expect(applied()!.layouts.length).toBeGreaterThan(3); // the built-in 30, not an AI subset
  });

  it("a thrown AI error → deterministic fallback (never crashes)", async () => {
    const { setters, applied } = makeSetters();
    const r = await applyTemplateBytesAsRemakeAI(SRC, "会社.pptx", setters, async () => { throw new Error("provider down"); });
    expect(r.ok).toBe(true);
    expect(r.usedAi).toBe(false);
    expect(applied()).toBeDefined();
  });

  it("garbage / all-hallucinated AI response → deterministic fallback", async () => {
    for (const raw of ["not json at all", JSON.stringify({ layouts: [{ base: "Made.Up.1" }] })]) {
      const { setters } = makeSetters();
      const r = await applyTemplateBytesAsRemakeAI(SRC, "x.pptx", setters, async () => raw);
      expect(r.ok).toBe(true);
      expect(r.usedAi).toBe(false);
    }
  });
});
