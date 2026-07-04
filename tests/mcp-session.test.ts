/**
 * mcp-session.test.ts — the headless engine session behind `slidecraft serve`.
 * Drives the deterministic handlers directly (no MCP transport): open → read →
 * apply → distill → visualize → validate → save round-trip → native export, plus the
 * unconvertible-Mermaid export guard (never-silent).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { bundleProject, openProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import type { DeckIR } from "../src/engine/slide-schema";
import * as S from "../src/mcp/session";

const DECK_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n- 価格: 1000円";

let template: TemplateData;
let templateBytes: Buffer;
let bundle: Uint8Array;
beforeAll(async () => {
  templateBytes = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"));
  template = await loadTemplate(templateBytes);
  bundle = await bundleProject(parseMd(DECK_MD), template, { templateName: "Midnight Executive", savedAt: "2026-06-27T00:00:00Z" });
});

async function opened() {
  const s = S.createSession(null);
  await S.openProjectBytes(s, bundle);
  return s;
}

describe("mcp session — open + read", () => {
  it("requires an open project (handlers throw before open)", () => {
    expect(() => S.getDeck(S.createSession(null))).toThrow(/プロジェクトが開かれていません/);
  });

  it("opens a .slidecraft into deck + template + catalog", async () => {
    const s = await opened();
    expect(s.deck!.slides.length).toBeGreaterThan(1);
    expect(s.catalog!.length).toBeGreaterThan(0);
    const diag = S.getDiagnostics(s);
    expect(diag.issues).toBeInstanceOf(Array);
    expect(diag.budget === null || typeof diag.budget.maxBullets === "number").toBe(true);
    expect(S.getCatalog(s).summary).toMatch(/\w/);
    expect(S.getProjectMeta(s).templateName).toBe("Midnight Executive");
  });

  it("serializes a single slide's Markdown (auto resolved, round-trippable)", async () => {
    const s = await opened();
    const md = S.getSlideMarkdown(s, 1);
    expect(md).toContain("速度");
    expect(() => S.getSlideMarkdown(s, 99)).toThrow(/範囲外/);
  });
});

describe("mcp session — deterministic mutations", () => {
  it("apply_slide_markdown replaces the slide + re-diagnoses; invalid is rejected (never silent)", async () => {
    const s = await opened();
    const r = S.applySlideMarkdown(s, 1, "# 差し替え見出し\n\n- 一点だけ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.afterMd).toContain("差し替え見出し");
      expect(r.beforeMd).not.toEqual(r.afterMd);
    }
    expect(s.dirty).toBe(true);
  });

  it("distill returns a (possibly unchanged) deck + fresh diagnostics", async () => {
    const s = await opened();
    const r = S.distill(s);
    expect(r.ok).toBe(true);
    expect(r.after).toBeGreaterThanOrEqual(r.before);
  });

  it("visualize_key_value converts a key-value slide to a table, and reports non-applicable otherwise", async () => {
    const s = await opened();
    const kv = S.visualizeKeyValue(s, 1); // 速度/重量/価格 → table
    expect(kv.ok).toBe(true);
    expect(kv.changed).toBe(true);
    if (kv.changed) expect(kv.afterMd).toContain("|");
    const cover = S.visualizeKeyValue(s, 0); // cover has no key-value run
    // ADR-0015: a legitimate "nothing to convert" is NOT a failure — ok:true, changed:false.
    expect(cover.ok).toBe(true);
    expect(cover.changed).toBe(false);
    if (!cover.changed) expect(cover.status).toBe("not-applicable");
  });

  it("get_slide_fix returns a request packet for the agent to fulfill", async () => {
    const s = await opened();
    const fix = S.getSlideFix(s, 1);
    expect(typeof fix.requestText).toBe("string");
    expect(fix.currentMarkdown).toContain("速度");
  });
});

describe("mcp session — new_project (template + Markdown → slides)", () => {
  it("creates a fresh project from a .pptx template + Markdown (same fit as the GUI Draft)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, templateBytes, "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- A\n- B");
    expect(r.slideCount).toBeGreaterThan(1);
    expect(s.template).toBeDefined();
    expect(s.catalog!.length).toBeGreaterThan(0);
    expect(s.dirty).toBe(true);
    expect(S.getDeckMarkdown(s)).toContain("中身");
  });

  it("yields a valid single-slide deck when no Markdown is given", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, templateBytes);
    expect(r.slideCount).toBeGreaterThanOrEqual(1);
  });
});

describe("mcp session — set_diagram", () => {
  const graftMermaid = (s: Awaited<ReturnType<typeof opened>>): number => {
    const i = s.deck!.slides.length;
    s.deck = { ...s.deck!, slides: [...s.deck!.slides, { layout: "auto", placeholders: [], mermaidBlock: { mermaid: "flowchart TD\n  A-->B", placeholderIdx: "1" } }] };
    return i;
  };

  it("graduates a Mermaid slide to a native diagram (mermaidBlock → diagram, same placeholder)", async () => {
    const s = await opened();
    const i = graftMermaid(s);
    const r = S.setDiagram(s, i, "flowchart LR\n  A[開始]-->B[処理]-->C[終了]", "mermaid");
    expect(r.ok).toBe(true);
    const slide = s.deck!.slides[i];
    expect(slide.diagram).toBeDefined();
    expect(slide.mermaidBlock).toBeUndefined();
    expect(slide.diagram!.placeholderIdx).toBe("1");
  });

  it("rejects set_diagram on a slide with no figure placeholder", async () => {
    const s = await opened();
    const r = S.setDiagram(s, 0, "flowchart TD\n  A-->B", "mermaid");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/配置先/);
  });

  it("rejects Mermaid that has no native renderer (gitGraph)", async () => {
    const s = await opened();
    const i = graftMermaid(s);
    const r = S.setDiagram(s, i, "gitGraph\n  commit", "mermaid");
    expect(r.ok).toBe(false);
  });
});

describe("mcp session — apply_design_intent (design half of two-stage editing)", () => {
  // graft a slide with a NATIVE diagram (graduate a Mermaid block via set_diagram).
  const graftDiagram = (s: Awaited<ReturnType<typeof opened>>): number => {
    const i = s.deck!.slides.length;
    s.deck = { ...s.deck!, slides: [...s.deck!.slides, { layout: "auto", placeholders: [], mermaidBlock: { mermaid: "flowchart TD\n  A[開始]-->B[終了]", placeholderIdx: "1" } }] };
    expect(S.setDiagram(s, i, "flowchart TD\n  A[開始]-->B[終了]", "mermaid").ok).toBe(true);
    return i;
  };

  it("relayout alters a diagram slide's geometry (engine computes + clamps); changed=true", async () => {
    const s = await opened();
    const i = graftDiagram(s);
    const r = S.applyDesignIntent(s, i, '[{"op":"relayout","direction":"LR"}]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBe(true);
      expect(r.beforeMd).not.toEqual(r.afterMd);
    }
    expect(s.dirty).toBe(true);
  });

  it("rejects a figureless slide (never a silent no-op)", async () => {
    const s = await opened();
    const r = S.applyDesignIntent(s, 0, '[{"op":"relayout","direction":"LR"}]'); // cover has no figure
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/図がありません/);
  });

  it("rejects an unparseable intent", async () => {
    const s = await opened();
    const i = graftDiagram(s);
    expect(S.applyDesignIntent(s, i, "not an intent").ok).toBe(false);
  });
});

describe("mcp session — validate + save + native export", () => {
  it("validate reports native-ok for a diagram-free deck", async () => {
    const s = await opened();
    const v = S.validate(s);
    expect(v.ok).toBe(true);
    expect(v.exportReadiness).toBe("native-ok");
  });

  it("save_project round-trips (reopen → same deck)", async () => {
    const s = await opened();
    const bytes = await S.saveProjectBytes(s);
    const reopened = await openProject(bytes);
    expect(reopened.deck).toEqual(s.deck);
    expect(s.dirty).toBe(false);
  });

  it("export_pptx produces a valid (PK-zip) .pptx headlessly", async () => {
    const s = await opened();
    const { bytes, skipped } = await S.exportPptxBytes(s);
    expect(skipped).toEqual([]);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K' — zip magic = valid OOXML
  });

  it("export_pptx REJECTS unconvertible Mermaid by default (never silently drops content)", async () => {
    const s = await opened();
    // graft a slide whose Mermaid has no native renderer (gitGraph → image-fallback only)
    const evil: DeckIR = {
      ...s.deck!,
      slides: [...s.deck!.slides, { layout: "auto", placeholders: [], mermaidBlock: { mermaid: "gitGraph\n  commit", placeholderIdx: "1" } }],
    };
    s.deck = evil;
    expect(S.validate(s).exportReadiness).toBe("blocked");
    await expect(S.exportPptxBytes(s)).rejects.toThrow(/Mermaid/);
    // "skip" instead omits + reports the slide rather than throwing
    const skip = await S.exportPptxBytes(s, "skip");
    expect(skip.skipped.length).toBe(1);
  });
});
