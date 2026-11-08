/**
 * edit-path-agreement.test.ts — #220 / R8: the two deck-editing doors must apply the SAME edit the SAME way.
 *
 *   MCP door  : src/mcp/session.ts      setDiagram / applySlideMarkdown / distill
 *   GUI door  : src/engine/ai-apply.ts  applyFigureYaml / reconcileSlideEdit (driven by useDeckController)
 *
 * Each door keeps its own OUTER shell (GUI: raw-AI-output sanitizing + adoption gate + editNotice; MCP:
 * placement guard + mutation envelope). The INNER "apply to the SlideIR" step is shared through
 * src/engine/apply-slide-edit.ts — this file pins (a) that both doors delegate there, (b) that they
 * agree on the same input, and (c) the divergences that still exist, as an explicit, reviewed list
 * (a ratchet like arch-conformance: a fixed divergence moves from KNOWN DIVERGENCE to agreement).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as S from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { applyFigureYaml, reconcileSlideEdit } from "../src/engine/ai-apply";
import { distillDeck } from "../src/engine/distill";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR } from "../src/engine/slide-schema";
import { applyFieldEdit } from "../src/engine/placeholder-binding";
import { textToParagraphs } from "../src/engine/field-text";
import { routeFieldEdit } from "../src/engine/field-edit-ops";
import { slideFigures } from "../src/engine/slide-figures";
import { routeDataEdit } from "../src/engine/chart-edit-ops";
import { DiagramSpecSchema } from "../src/engine/schema";
import { loadYaml } from "../src/engine/yaml-io";
import { routeSlideEdit, previewRoutedEdit, editNoticeOf } from "../src/engine/slide-edit-route";
import { parseDiagramEditOps, applyDiagramEditOps, checkDeleteIntent, buildOpsRetryInstruction } from "../src/engine/diagram-edit-ops";
import { parseDesignIntent, applyDesignIntentReport } from "../src/engine/design-intent";
import { previewFigureEdit, figureFence, figureFallbackTag } from "../src/engine/ai-apply";
import { describeEditableFields } from "../src/engine/field-edit-ops";
import { describeEditableData } from "../src/engine/chart-edit-ops";
import { slideEditUserPrompt } from "../src/engine/deck-plan-prompts";
import { serializeMd } from "../src/engine/md-serializer";
import { autoSelectLayout, loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { batchEditDeck } from "../src/engine/refine";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

const MD = "# 表紙\n\n---\n\n# 中身\n\n- 一\n- 二\n- 三"; // 0 = cover (no body), 1 = content (3 bullets)
// Already-clean YAML (no fence / preamble / trailing newline): GUI input sanitizing is a GUI-shell concern.
const OLD_YAML = "type: flowchart\nnodes:\n  - id: a\n    label: A";
const NEW_YAML = "type: flowchart\nnodes:\n  - id: b\n    label: B";
const MERMAID = "flowchart TD\n  A-->B";
const bodyless = (sl: SlideIR): SlideIR => ({ ...sl, placeholders: sl.placeholders.filter((p) => !/^[1-9]$/.test(p.idx)) });

/** A session whose slide 1 is `patch`ed, plus the untouched old slide 1 (what the GUI door starts from). */
async function session(patch?: (sl: SlideIR) => SlideIR) {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, MD);
  if (patch) s.deck = { ...s.deck!, slides: s.deck!.slides.map((sl, k) => (k === 1 ? patch(sl) : sl)) };
  return { s, old: s.deck!.slides[1] };
}

describe("#220 delegation: both doors apply figures through the shared engine module", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../src", p), "utf8");
  it("session.ts and ai-apply.ts import placeFigureYaml / figureSourceToYaml from apply-slide-edit", () => {
    expect(src("mcp/session.ts")).toMatch(/import \{[^}]*\bplaceFigureYaml\b[^}]*\} from "\.\.\/engine\/apply-slide-edit"/);
    expect(src("mcp/session.ts")).toMatch(/import \{[^}]*\bfigureSourceToYaml\b[^}]*\} from "\.\.\/engine\/apply-slide-edit"/);
    expect(src("engine/ai-apply.ts")).toMatch(/import \{[^}]*\bplaceFigureYaml\b[^}]*\} from "\.\/apply-slide-edit"/);
    expect(src("engine/ai-apply.ts")).toMatch(/import \{[^}]*\bfigureSourceToYaml\b[^}]*\} from "\.\/apply-slide-edit"/);
  });
  it("B3: both doors carry omitted blocks / reject a broken diagram through the shared helpers", () => {
    expect(src("mcp/session.ts")).toMatch(/import \{[^}]*\bcarryOmittedBlocks\b[^}]*\} from "\.\.\/engine\/apply-slide-edit"/);
    expect(src("mcp/session.ts")).toMatch(/import \{[^}]*\beditedDiagramError\b[^}]*\} from "\.\.\/engine\/apply-slide-edit"/);
    expect(src("engine/ai-reconcile.ts")).toMatch(/import \{[^}]*\bcarryOmittedBlocks\b[^}]*\} from "\.\/apply-slide-edit"/);
    expect(src("engine/ai-apply.ts")).toMatch(/import \{[^}]*\beditedDiagramError\b[^}]*\} from "\.\/apply-slide-edit"/);
  });
  it("A2: the add-layout knob is gone — one placement rule (pin kept) for both doors", () => {
    expect(src("engine/apply-slide-edit.ts")).not.toMatch(/\baddLayout\b/);
    expect(src("mcp/session.ts")).not.toMatch(/\baddLayout\b/);
    expect(src("engine/ai-apply.ts")).not.toMatch(/\baddLayout\b/);
  });
  it("neither door re-implements the coexist placement (applyRegionSplit) itself any more", () => {
    expect(src("mcp/session.ts")).not.toMatch(/\bapplyRegionSplit\b/);
    expect(src("engine/ai-apply.ts")).not.toMatch(/\bapplyRegionSplit\b/);
  });
});

describe("#220 agreement: set_diagram (MCP) ≡ applyFigureYaml (GUI) on the same YAML", () => {
  const cases: Array<[string, ((sl: SlideIR) => SlideIR) | undefined]> = [
    ["replace an existing diagram", (sl) => ({ ...sl, diagram: { yaml: OLD_YAML, placeholderIdx: "1" } })],
    ["graduate a Mermaid block to a native diagram", (sl) => ({ ...bodyless(sl), mermaidBlock: { mermaid: MERMAID, placeholderIdx: "1" } })],
    ["add to a text slide → coexist (text-left, figure col 2)", undefined],
    ["add to a pinned text slide → coexist (regionSplit re-autos the layout)", (sl) => ({ ...sl, layout: "Content.1Body.Single" })],
    // Was a divergence (MCP silently dropped the coexisting Mermaid figure); unified to the GUI's
    // keep — the Issue's invariant 'native figure を無言で落とさない'.
    ["replace the diagram of a slide that ALSO carries a Mermaid block (Mermaid kept)", (sl) => ({ ...sl, diagram: { yaml: OLD_YAML, placeholderIdx: "1" }, mermaidBlock: { mermaid: MERMAID, placeholderIdx: "2" } })],
    // Was a KNOWN DIVERGENCE (MCP kept the pin, GUI reset to auto); 統括裁定 A2 → both keep the user's pin.
    ["add to a pinned slide whose body is EMPTY → the pin is kept", (sl) => ({ ...bodyless(sl), layout: "Content.1Body.Single" })],
  ];
  for (const [name, patch] of cases) {
    it(name, async () => {
      const { s, old } = await session(patch);
      const gui = applyFigureYaml(old, NEW_YAML);
      const r = S.setDiagram(s, 1, NEW_YAML, "yaml");
      expect(r.ok).toBe(true);
      expect(gui).not.toBeNull();
      expect(s.deck!.slides[1]).toEqual(gui);
    });
  }

  it("the both-figures case keeps the Mermaid block on the MCP door too (no silent drop)", async () => {
    const { s } = await session(cases[4][1]);
    S.setDiagram(s, 1, NEW_YAML, "yaml");
    expect(s.deck!.slides[1].mermaidBlock).toEqual({ mermaid: MERMAID, placeholderIdx: "2" });
    expect(s.deck!.slides[1].diagram).toEqual({ yaml: NEW_YAML, placeholderIdx: "1" });
  });
});

describe("#220 A2: pin kept on add; the GUI shell rescues only a pin with NO body region", () => {
  it("the pinned-empty-body add keeps the pin on both doors (no re-auto)", async () => {
    const { s, old } = await session((sl) => ({ ...bodyless(sl), layout: "Content.1Body.Single" }));
    expect(S.setDiagram(s, 1, NEW_YAML, "yaml").ok).toBe(true);
    expect(s.deck!.slides[1].layout).toBe("Content.1Body.Single");
    expect(applyFigureYaml(old, NEW_YAML)!.layout).toBe("Content.1Body.Single");
  });
  // INTENDED shell difference (裁定 A2): a pin whose layout has NO body region can't host the figure. MCP
  // rejects (never-silent, the agent re-pins); the GUI has no reject channel at adoption, so its shell
  // re-autos — judged by the SAME resolved-layout body count the MCP guard uses (resolvedBodyCount).
  it("a bodyless pin: MCP rejects, the GUI shell (with layout context) re-autos", async () => {
    const { s, old } = await session((sl) => ({ ...bodyless(sl), layout: "Section.1Title.Single" }));
    expect(S.setDiagram(s, 1, NEW_YAML, "yaml").ok).toBe(false);
    const ctx = { index: 1, total: s.deck!.slides.length, catalog: s.catalog! };
    expect(applyFigureYaml(old, NEW_YAML, ctx)!.layout).toBe("auto");
    expect(applyFigureYaml(old, NEW_YAML, ctx)!.diagram).toEqual({ yaml: NEW_YAML, placeholderIdx: "1" });
    // a pin WITH a body region is kept even with the context (the rescue is only for bodyless pins)
    const pinned = { ...old, layout: "Content.1Body.Single" };
    expect(applyFigureYaml(pinned, NEW_YAML, ctx)!.layout).toBe("Content.1Body.Single");
  });
});

describe("#220 agreement: apply_slide_markdown (MCP) ≡ reconcileSlideEdit (GUI) on clean edits", () => {
  const tplOf = (s: S.Session) => ({ catalog: s.catalog!, layouts: s.template!.layouts });
  it("a clean text edit (title kept) applies identically", async () => {
    const { s, old } = await session();
    const edit = "# 中身改\n\n- 一\n- 二";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
    expect(gui.warnings).toEqual([]);
    expect(s.deck!.slides[1]).toEqual(gui.slide);
  });
  it("a text edit that omits the ```diagram fence carries the figure on both doors", async () => {
    const { s, old } = await session((sl) => ({ ...sl, diagram: { yaml: OLD_YAML, placeholderIdx: "2" } }));
    const edit = "# 中身\n\n- 一";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
    expect(s.deck!.slides[1]).toEqual(gui.slide);
    expect(s.deck!.slides[1].diagram).toEqual({ yaml: OLD_YAML, placeholderIdx: "2" });
  });

  // Was a KNOWN DIVERGENCE (MCP silently dropped the table); 統括裁定 B3 → both carry it (shared carryOmittedBlocks).
  it("an edit that omits the table carries it on both doors", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 中身\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    const old = s.deck!.slides[1];
    expect(old.table).toBeDefined();
    const gui = reconcileSlideEdit(old, "# 中身\n\n- 表は消した", tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, "# 中身\n\n- 表は消した").ok).toBe(true);
    expect(gui.slide.table).toEqual(old.table);
    expect(s.deck!.slides[1]).toEqual(gui.slide);
  });
  it("an edit that omits the code block carries it on both doors", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 中身\n\n```ts\nconst a = 1;\n```");
    const old = s.deck!.slides[1];
    expect(old.code).toBeDefined();
    const gui = reconcileSlideEdit(old, "# 中身\n\n- コードは消した", tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, "# 中身\n\n- コードは消した").ok).toBe(true);
    expect(gui.slide.code).toEqual(old.code);
    expect(s.deck!.slides[1]).toEqual(gui.slide);
  });
  it("an edit that REPLACES the table applies the new one on both doors (carry is only for omission)", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 中身\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    const old = s.deck!.slides[1];
    const edit = "# 中身\n\n| x | y |\n|---|---|\n| 3 | 4 |";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
    expect(s.deck!.slides[1].table).not.toEqual(old.table);
    expect(s.deck!.slides[1]).toEqual(gui.slide);
  });
  // #392 D1: a text-only edit of a 2-figure slide used to drop the 2nd figure silently (figures 2→1, no notice).
  const TWO_DIAGS = "# 表紙\n\n---\n\n# 中身\n\n```diagram\ntype: flowchart\nnodes:\n  - id: one\n    label: ONE\n```\n\n```diagram\ntype: flowchart\nnodes:\n  - id: two\n    label: TWO\n```";
  it("#392 D1: a text-only edit of a slide with 2 figures keeps both on both doors", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, TWO_DIAGS);
    const old = s.deck!.slides[1];
    expect(slideFigures(old)).toHaveLength(2);
    const edit = "# 中身\n\n- 本文だけ直した";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
    expect(slideFigures(s.deck!.slides[1])).toEqual(slideFigures(old));
    expect(s.deck!.slides[1].figures).toEqual(old.figures);
    expect(s.deck!.slides[1]).toEqual(gui.slide);
  });
  // #392 段 3 (per-figure carry, replaces the 段 1 D1 minimum "an edit with its own visual drops the old
  // figures list"): the edit's i-th visual of a kind replaces the old i-th; the old ones it omits stay put.
  it("#392 段 3: an edit that carries only the 1st of 2 diagrams replaces the 1st and keeps the 2nd on both doors", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, TWO_DIAGS);
    const old = s.deck!.slides[1];
    const edit = "# 中身\n\n- 本文\n\n```diagram\ntype: flowchart\nnodes:\n  - id: solo\n    label: SOLO\n```";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
    const after = s.deck!.slides[1];
    const ids = slideFigures(after).map((f) => (f.kind === "diagram" ? f.yaml.match(/id: (\w+)/)![1] : f.kind));
    expect(ids).toEqual(["solo", "two"]);
    expect(after.diagram?.yaml).toContain("id: solo");
    expect(after).toEqual(gui.slide);
  });
  const TABLE_TWO_DIAGS = TWO_DIAGS.replace("# 中身\n\n", "# 中身\n\n| k | v |\n|---|---|\n| a | 1 |\n\n");
  it("#392 段 3: an edit that keeps only the table carries both diagrams in their old places on both doors", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, TABLE_TWO_DIAGS);
    const old = s.deck!.slides[1];
    expect(slideFigures(old).map((f) => f.kind)).toEqual(["table", "diagram", "diagram"]);
    const edit = "# 中身\n\n| k | v |\n|---|---|\n| a | 9 |";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
    const after = s.deck!.slides[1];
    expect(slideFigures(after).map((f) => f.kind)).toEqual(["table", "diagram", "diagram"]);
    expect(after.table?.rows[1]).toEqual(["a", "9"]);
    expect(slideFigures(after).slice(1)).toEqual(slideFigures(old).slice(1));
    expect(after).toEqual(gui.slide);
  });
  it("#392 段 3: an edit that carries every visual in a new order is taken as is (its order wins) on both doors", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, TABLE_TWO_DIAGS);
    const old = s.deck!.slides[1];
    const d = (id: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: " + id + "\n    label: " + id.toUpperCase() + "\n```";
    const edit = `# 中身\n\n${d("one")}\n\n| k | v |\n|---|---|\n| a | 1 |\n\n${d("two")}`;
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(S.applySlideMarkdown(s, 1, edit).ok).toBe(true);
    const after = s.deck!.slides[1];
    expect(slideFigures(after).map((f) => f.kind)).toEqual(["diagram", "table", "diagram"]);
    expect(after).toEqual(gui.slide);
  });

  // #392 段 3: set_slide_diagram `figure` (MCP) ≡ applyFigureYaml's target (GUI) — the n-th figure
  // (diagram / Mermaid, source order). Omitted = the first figure, as before.
  it("#392 段 3: figure 2 replaces only the 2nd diagram, the same on both doors", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, TABLE_TWO_DIAGS);
    const old = s.deck!.slides[1];
    const gui = applyFigureYaml(old, NEW_YAML, undefined, 2);
    const r = S.setDiagram(s, 1, NEW_YAML, "yaml", undefined, 2);
    expect(r.ok).toBe(true);
    expect(r.ok && r.created).toBe(false);
    const after = s.deck!.slides[1];
    expect(after).toEqual(gui);
    const ys = slideFigures(after).map((f) => (f.kind === "diagram" ? f.yaml : f.kind));
    expect(ys[0]).toBe("table");
    expect(ys[1]).toContain("id: one");
    expect(ys[2]).toBe(NEW_YAML);
    expect(previewFigureEdit(old, NEW_YAML, undefined, 2)).toEqual({ beforeMd: figureFence(old, 2), afterMd: "```diagram\n" + NEW_YAML + "\n```" });
    expect(figureFence(old, 2)).toContain("id: two");
  });
  it("#392 段 3: figure omitted on a 2-diagram slide = the 1st (unchanged); figure 1 is the same", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, TWO_DIAGS);
    const old = s.deck!.slides[1];
    expect(applyFigureYaml(old, NEW_YAML, undefined, 1)).toEqual(applyFigureYaml(old, NEW_YAML));
    S.setDiagram(s, 1, NEW_YAML, "yaml");
    expect(s.deck!.slides[1]).toEqual(applyFigureYaml(old, NEW_YAML));
    expect(s.deck!.slides[1].diagram?.yaml).toBe(NEW_YAML);
    expect(slideFigures(s.deck!.slides[1])[1]).toEqual(slideFigures(old)[1]);
  });
  it("#392 段 3: figure out of range — MCP rejects (never-silent, nothing saved), the GUI target returns null", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, TWO_DIAGS);
    const deckBefore = s.deck;
    const r = S.setDiagram(s, 1, NEW_YAML, "yaml", undefined, 3);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("1..2");
    expect(s.deck).toBe(deckBefore);
    expect(applyFigureYaml(deckBefore!.slides[1], NEW_YAML, undefined, 3)).toBeNull();
  });
  // Was a KNOWN DIVERGENCE (MCP stored the broken YAML). 裁定 B3: neither door stores it — the GUI keeps the
  // old valid figure + an advisory (its adoption gate), MCP rejects the whole edit (never-silent, nothing saved).
  it("an edit carrying a BROKEN diagram: GUI keeps the old one, MCP rejects and saves nothing", async () => {
    const { s, old } = await session((sl) => ({ ...sl, diagram: { yaml: OLD_YAML, placeholderIdx: "2" } }));
    const edit = "# 中身\n\n- 一\n\n```diagram\ntype: flowchart\nnodes: [oops\n```";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    expect(gui.slide.diagram?.yaml).toBe(OLD_YAML);
    const deckBefore = s.deck, dirtyBefore = s.dirty;
    expect(() => S.applySlideMarkdown(s, 1, edit)).toThrow(expect.objectContaining({ name: "GuardError", code: "invalid-argument" }));
    expect(s.deck).toBe(deckBefore); // nothing saved (same deck object, not even a re-write)
    expect(s.dirty).toBe(dirtyBefore);
  });

  // INTENDED DIVERGENCES (統括裁定 B3 — GUI shell only): restoring a dropped title and keeping the old slide on
  // a content-less edit would override what the upstream (MCP) agent deliberately sent, so MCP applies as-is.
  it("INTENDED: edit drops the title — GUI restores it, MCP applies the drop", async () => {
    const { s, old } = await session();
    const gui = reconcileSlideEdit(old, "- 一だけ", tplOf(s))!;
    S.applySlideMarkdown(s, 1, "- 一だけ");
    const title = (sl: SlideIR) => sl.placeholders.find((p) => p.idx === "15");
    expect(title(gui.slide)?.paragraphs[0].segments[0].text).toBe("中身");
    expect(title(s.deck!.slides[1])).toBeUndefined();
  });
  it("INTENDED: a content-less edit — GUI keeps the old slide (meltdown guard), MCP empties it", async () => {
    const { s, old } = await session();
    const gui = reconcileSlideEdit(old, "<!-- slide: auto -->\n", tplOf(s))!;
    S.applySlideMarkdown(s, 1, "<!-- slide: auto -->\n");
    expect(gui.slide.placeholders).toEqual(old.placeholders);
    expect(s.deck!.slides[1].placeholders).toEqual([]);
  });
});

describe("#220 agreement: distill (MCP) ≡ distillDeck (GUI)", () => {
  it("session.distill produces exactly distillDeck's deck", async () => {
    const many = Array.from({ length: 30 }, (_, k) => `- 項目${k} の説明文をそれなりの長さで書く`).join("\n");
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙");
    // newProject already distills — load the UNdistilled parse so distill has real work to do.
    s.deck = parseMd("# 表紙\n\n---\n\n# 長い\n\n" + many, s.catalog);
    const gui = distillDeck(s.deck, s.catalog!);
    const r = S.distill(s);
    expect(r.changed).toBe(true); // the overflowing slide really split
    expect(s.deck).toEqual(gui);
  });
});

describe("#220 B3 through the MCP envelope (set_slide_markdown)", () => {
  type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
  async function client(): Promise<Client> {
    const server = buildServer(S.createSession(null));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: "test", version: "1.0.0" });
    await c.connect(ct);
    return c;
  }
  async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
    const res = (await c.callTool({ name, arguments: args })) as unknown as CallRes;
    const text = res.content[0]?.text ?? "null";
    return { isError: !!res.isError, data: res.isError ? undefined : (JSON.parse(text) as Record<string, unknown>) };
  }
  const DECK = "# 表紙\n\n---\n\n# 中身\n\n| a | b |\n|---|---|\n| 1 | 2 |";

  it("a broken diagram YAML → modeled reject {ok:false, code:'invalid-argument'}, nothing saved", async () => {
    const c = await client();
    await call(c, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: DECK });
    const before = (await call(c, "get_slide_markdown", { index: 1 })).data;
    const r = await call(c, "set_slide_markdown", { index: 1, markdown: "# 中身\n\n```diagram\ntype: flowchart\nnodes: [oops\n```" });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(String(r.data!.error)).toContain("diagram");
    expect(r.data).not.toHaveProperty("rev"); // not committed
    expect((await call(c, "get_slide_markdown", { index: 1 })).data).toEqual(before);
  });

  it("a text edit that omits the table keeps the table (ok:true envelope, table in afterMd)", async () => {
    const c = await client();
    await call(c, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: DECK });
    const r = await call(c, "set_slide_markdown", { index: 1, markdown: "# 中身改\n\n- 表は消した" });
    expect(r.data).toMatchObject({ ok: true, changed: true });
    expect(String(r.data!.afterMd)).toContain("| a | b |");
    expect(String(r.data!.afterMd)).toContain("表は消した");
  });

  it("#392 段 3: set_slide_diagram {figure: 2} replaces the 2nd diagram through the envelope; out of range → ok:false", async () => {
    const c = await client();
    const d = (id: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: " + id + "\n    label: " + id + "\n```";
    await call(c, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: `# 表紙\n\n---\n\n# 中身\n\n${d("one")}\n\n${d("two")}` });
    const r = await call(c, "set_slide_diagram", { index: 1, source: NEW_YAML, format: "yaml", figure: 2 });
    expect(r.data).toMatchObject({ ok: true, changed: true, created: false });
    const md = String(r.data!.afterMd);
    expect(md).toContain("id: one");
    expect(md).not.toContain("id: two");
    expect(md.indexOf("id: one")).toBeLessThan(md.indexOf("id: b"));
    const bad = await call(c, "set_slide_diagram", { index: 1, source: NEW_YAML, format: "yaml", figure: 3 });
    expect(bad.data).toMatchObject({ ok: false });
    expect(String(bad.data!.error)).toContain("1..2");
  });
});

// ── #106 P2: placeholder TEXT edits — the AI setField ops door ≡ the GUI field-editor door ──
// Both write one placeholder's text through applyFieldEdit(textToParagraphs(text)): the field editor
// (SlideEditor.updatePlaceholder) by hand, the AI panel (useDeckController handleApplySlide /
// previewSlideEdit → routeSlideEdit → routeFieldEdit, #629) from a setField ops array. No MCP door here (統括裁定 2026-11-07:
// no placeholder-level MCP tool — set_slide_markdown covers it).
describe("#106 P2 delegation: the setField door goes through the field editor's primitive", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../src", p), "utf8");
  it("field-edit-ops.ts applies via applyFieldEdit + textToParagraphs (no own merge)", () => {
    expect(src("engine/field-edit-ops.ts")).toMatch(/import \{[^}]*\bapplyFieldEdit\b[^}]*\} from "\.\/placeholder-binding"/);
    expect(src("engine/field-edit-ops.ts")).toMatch(/import \{[^}]*\btextToParagraphs\b[^}]*\} from "\.\/field-text"/);
    expect(src("components/SlideEditor.tsx")).toMatch(/applyFieldEdit\(slide\.placeholders, idx, textToParagraphs\(text\)\)/);
  });
  it("the GUI controller routes AI output through routeFieldEdit in BOTH apply and preview", () => {
    // #629: the branch moved to slide-edit-route.ts; the GUI reaches it via routeSlideEdit in both doors.
    expect(src("engine/slide-edit-route.ts")).toMatch(/import \{[^}]*\brouteFieldEdit\b[^}]*\} from "\.\/field-edit-ops"/);
    expect(src("components/useDeckController.ts").match(/\brouteSlideEdit\(/g)?.length).toBe(2);
  });
});

describe("#106 P2 agreement: setField ops (AI door) ≡ field editor (GUI door) on a real parsed slide", () => {
  const slide = parseMd(MD).slides[1]; // content slide: title + 3 bullets
  const fieldEditor = (sl: SlideIR, idx: string, text: string): SlideIR => ({
    ...sl, placeholders: applyFieldEdit(sl.placeholders, idx, textToParagraphs(text)),
  });
  const bodyIdx = slide.placeholders.find((p) => p.idx !== "0" && p.idx !== "15")!.idx;
  const titleIdx = slide.placeholders.find((p) => p.idx === "0" || p.idx === "15")!.idx;
  const cases: Array<[string, string, string]> = [
    ["retitle", titleIdx, "中身（改訂）"],
    ["rewrite the bullets", bodyIdx, "- 一\n- 二改\n  - 補足"],
    ["clear the body", bodyIdx, ""],
  ];
  for (const [name, idx, text] of cases) {
    it(name, () => {
      const r = routeFieldEdit(slide, JSON.stringify([{ op: "setField", idx, text }]));
      expect(r?.kind).toBe("ops");
      if (r?.kind !== "ops") return;
      expect(r.notices).toEqual([]);
      expect(r.slide).toEqual(fieldEditor(slide, idx, text));
    });
  }
});

// ── #106 P3: DATA edits (table cell / chart value / gantt task / KPI card) — the AI DATA-ops door ≡ the
// Markdown editor door (handleSlideMdChange → parseMd of the edited slide Markdown). DATA ops are routed
// right beside setField, only when routeFieldEdit had no result — since #629 inside slide-edit-route.ts,
// which the GUI calls in BOTH apply and preview (see #106 P2). No MCP door (統括裁定: no new tools).
describe("#106 P3 delegation: the GUI controller routes AI output through routeDataEdit in BOTH apply and preview", () => {
  it("routeDataEdit sits beside routeFieldEdit (same result shape, same branch)", () => {
    const route = readFileSync(resolve(__dirname, "../src/engine/slide-edit-route.ts"), "utf8");
    expect(route).toMatch(/import \{[^}]*\brouteDataEdit\b[^}]*\} from "\.\/chart-edit-ops"/);
    expect(route.match(/const (\w+) = routeFieldEdit\([^)]*\);\s*const \w+ = \1 \? null : routeDataEdit\(/g)?.length).toBe(1);
  });
});

describe("#106 P3 agreement: DATA ops (AI door) ≡ editing the slide Markdown (Markdown-editor door)", () => {
  const TABLE = "# 表\n\n| 項目 | 値 |\n| --- | --- |\n| 売上 | 100 |";
  const XY = "# 図\n\n```diagram\ntype: xychart\nnodes: []\nxychart:\n  categories: [Q1, Q2]\n  series:\n    - kind: bar\n      name: 売上\n      values: [10, 20]\n```";
  it("setCell ≡ the GFM table edited in Markdown", () => {
    const slide = parseMd(TABLE).slides[0];
    const r = routeDataEdit(slide, JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "120" }]));
    expect(r?.kind).toBe("ops");
    if (r?.kind !== "ops") return;
    expect(r.notices).toEqual([]);
    expect(r.slide.table).toEqual(parseMd(TABLE.replace("| 売上 | 100 |", "| 売上 | 120 |")).slides[0].table);
  });
  it("setSeriesValue ≡ the figure YAML edited in Markdown (same rendered spec)", () => {
    const slide = parseMd(XY).slides[0];
    const r = routeDataEdit(slide, JSON.stringify([{ op: "setSeriesValue", series: 0, index: 1, value: 25 }]));
    expect(r?.kind).toBe("ops");
    if (r?.kind !== "ops") return;
    const direct = parseMd(XY.replace("values: [10, 20]", "values: [10, 25]")).slides[0];
    // The rendered spec agrees; the YAML TEXT may be re-dumped (block style) exactly as the P1 figure ops do.
    const spec = (s: SlideIR) => DiagramSpecSchema.parse(loadYaml(s.diagram!.yaml));
    expect(r.notices).toEqual([]);
    expect(spec(r.slide)).toEqual(spec(direct));
  });
});

// ── #106 P4: ONE router for a model's reply (R8). The AI panel's apply + preview, the batch edit and the
// refine loop all call routeSlideEdit (src/engine/slide-edit-route.ts). The branch was MOVED out of
// useDeckController; the oracle below is the pre-P4 GUI branch, kept verbatim as the reference, so the
// move is pinned to change neither the slide nor the banner / review warnings on any route.
describe("#106 P4 delegation: every door routes a reply through routeSlideEdit", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../src", p), "utf8");
  it("the GUI controller calls routeSlideEdit in BOTH apply and preview, and no longer branches itself", () => {
    const ctl = src("components/useDeckController.ts");
    expect(ctl).toMatch(/import \{[^}]*\brouteSlideEdit\b[^}]*\} from "\.\.\/engine\/slide-edit-route"/);
    expect(ctl.match(/\brouteSlideEdit\(/g)?.length).toBe(2);
    expect(ctl).not.toMatch(/\b(parseDiagramEditOps|routeFieldEdit|routeDataEdit|parseDesignIntent|reconcileSlideEdit)\(/);
  });
  it("the router itself goes through the P1–P3 modules (routeFieldEdit ?? routeDataEdit order kept)", () => {
    const r = src("engine/slide-edit-route.ts");
    expect(r).toMatch(/import \{[^}]*\brouteFieldEdit\b[^}]*\} from "\.\/field-edit-ops"/);
    expect(r).toMatch(/import \{[^}]*\brouteDataEdit\b[^}]*\} from "\.\/chart-edit-ops"/);
    expect(r).toMatch(/import \{[^}]*\bparseDiagramEditOps\b[^}]*\} from "\.\/diagram-edit-ops"/);
  });
  it("refine.ts (batch + condense) reads every reply through ONE helper that calls routeOpsReply", () => {
    const r = src("engine/refine.ts");
    expect(r).toMatch(/import \{[^}]*\brouteOpsReply\b[^}]*\} from "\.\/slide-edit-route"/);
    expect(r.match(/\brouteOpsReply\(/g)?.length).toBe(1); // inside readReply
    expect(r.match(/\breadReply\(/g)?.length).toBe(3); // definition + refineDeck + batchEditDeck
  });
});

describe("#106 P4 agreement: routeSlideEdit ≡ the pre-P4 GUI branch (apply + preview) on every route", () => {
  type Legacy = { slide: SlideIR | null; notice: string | null | undefined };
  // Pre-P4 handleApplySlide (old slide present), verbatim except setEditNotice → returned `notice`
  // (undefined = the banner was not touched).
  const legacyApply = (old: SlideIR, raw: string, instruction?: string): Legacy => {
    const fig = applyFigureYaml(old, raw);
    if (fig) return { slide: fig, notice: undefined };
    const editOps = parseDiagramEditOps(raw);
    if (editOps) {
      const { slide, skipped } = applyDiagramEditOps(old, editOps);
      const notices = [...skipped.map((sk) => sk.message), ...(instruction ? checkDeleteIntent(old, editOps, instruction).map((a) => a.message) : [])];
      return { slide, notice: notices.length > 0 ? notices.join(" ｜ ") : null };
    }
    const field = routeFieldEdit(old, raw) ?? routeDataEdit(old, raw);
    if (field?.kind === "ops") return { slide: field.slide, notice: field.notices.length > 0 ? field.notices.join(" ｜ ") : null };
    const fallbackNotice = field?.kind === "fallback" ? field.notice : null;
    const intent = parseDesignIntent(raw);
    if (intent) {
      const { slide, skipped } = applyDesignIntentReport(old, intent);
      return { slide, notice: skipped.length > 0 ? skipped.map((sk) => sk.message).join(" ｜ ") : null };
    }
    const rec = reconcileSlideEdit(old, raw);
    if (!rec) return { slide: null, notice: fallbackNotice ?? undefined };
    return { slide: rec.slide, notice: fallbackNotice };
  };
  // Pre-P4 previewSlideEdit (catalog-less: layout resolves without a catalog, as the GUI does before load).
  const legacyPreview = (s: SlideIR, raw: string, instruction?: string) => {
    const editOps = parseDiagramEditOps(raw);
    if (editOps) {
      const { slide: merged, skipped } = applyDiagramEditOps(s, editOps);
      const warnings = [...skipped.map((sk) => sk.message), ...(instruction ? checkDeleteIntent(s, editOps, instruction).map((a) => a.message) : [])];
      return { afterMd: figureFence(merged) ?? "", warnings, beforeMd: figureFence(s) ?? "" };
    }
    const field = routeFieldEdit(s, raw) ?? routeDataEdit(s, raw);
    if (field?.kind === "ops") {
      const layout = autoSelectLayout(field.slide, 1, 3);
      return { afterMd: serializeMd({ slides: [{ ...field.slide, layout }] }), warnings: field.notices };
    }
    const fig = previewFigureEdit(s, raw);
    if (fig) return { afterMd: fig.afterMd, warnings: [], beforeMd: fig.beforeMd };
    if (parseDesignIntent(raw)) return null;
    const rec = reconcileSlideEdit(s, raw);
    if (!rec) return null;
    const resolved = autoSelectLayout(rec.slide, 1, 3);
    const hadFigure = !!s.diagram || !!s.mermaidBlock;
    const shouldRetry = hadFigure && rec.warnings.length > 0;
    return {
      afterMd: serializeMd({ slides: [{ ...rec.slide, layout: resolved }] }),
      warnings: [...(field?.kind === "fallback" ? [field.notice] : []), ...figureFallbackTag(hadFigure, rec.warnings)],
      ...(shouldRetry ? { shouldRetry, ...(instruction ? { retryInstruction: buildOpsRetryInstruction(s, instruction) } : {}) } : {}),
    };
  };

  const TEXT = parseMd("# 中身\n\n- 一\n- 二\n- 三").slides[0];
  const TABLE = parseMd("# 表\n\n| 項目 | 値 |\n| --- | --- |\n| 売上 | 100 |").slides[0];
  const FIG = parseMd("# 図\n\n- 説明\n\n```diagram\ntype: flowchart\nnodes:\n  - id: a\n    label: 受付\n  - id: b\n    label: 処理 120\nedges:\n  - from: a\n    to: b\n```").slides[0];
  const body = TEXT.placeholders.find((p) => p.idx !== "0" && p.idx !== "15")!.idx;
  const cases: Array<[string, SlideIR, string, string?]> = [
    ["figure YAML", FIG, NEW_YAML],
    ["diagram ops (clean)", FIG, JSON.stringify([{ op: "nodeUpdate", id: "a", label: "窓口" }])],
    ["diagram ops (skip + delete intent)", FIG, JSON.stringify([{ op: "removeNode", id: "b" }, { op: "nodeUpdate", id: "zz", label: "X" }]), "受付を窓口に"],
    ["setField (clean)", TEXT, JSON.stringify([{ op: "setField", idx: body, text: "一だけ" }])],
    ["setField (skip)", TEXT, JSON.stringify([{ op: "setField", idx: "99", text: "x" }])],
    ["setField (malformed → fallback)", TEXT, JSON.stringify([{ op: "setField", idx: body }])],
    ["setCell", TABLE, JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "120" }])],
    ["setCell (malformed → fallback)", TABLE, JSON.stringify([{ op: "setCell", row: -1, col: 1, text: "x" }])],
    ["design intent", FIG, JSON.stringify([{ op: "relayout", direction: "LR" }])],
    ["Markdown edit", TEXT, "# 中身\n\n- 一\n- 二"],
    ["Markdown on a figure slide that drifts (retry nudge)", FIG, "# 図\n\n- 説明 999", "直して"],
    ["unparseable", TEXT, ""],
  ];
  for (const [name, old, raw, instruction] of cases) {
    it(name, () => {
      const r = routeSlideEdit(old, raw, { instruction });
      const legacy = legacyApply(old, raw, instruction);
      expect(r.slide).toEqual(legacy.slide);
      expect(editNoticeOf(r)).toEqual(legacy.notice);
      expect(previewRoutedEdit(old, raw, r, { index: 1, total: 3 })).toEqual(legacyPreview(old, raw, instruction));
    });
  }
});

describe("#106 P4 agreement: the batch edit asks with the AI panel's request (slideEditUserPrompt)", () => {
  it("same slide → byte-identical request text (Fields + Data listings included)", async () => {
    const tpl = await loadTemplate(templateBytes);
    const catalog = buildCatalog(tpl);
    const deck = parseMd("# 表紙\n\n---\n\n# 表\n\n- 注記\n\n| 項目 | 値 |\n| --- | --- |\n| 売上 | 100 |", catalog);
    const reqs: string[] = [];
    await batchEditDeck(deck, catalog, { indices: [1], instruction: "売上を 120 に", aiFix: async (req) => { reqs.push(req); return { ok: false, cancelled: true }; } });
    const s = deck.slides[1];
    const slideMd = serializeMd({ slides: [{ ...s, layout: autoSelectLayout(s, 1, deck.slides.length, catalog) }] });
    expect(describeEditableData(s)).not.toBe(""); // the listing is really exercised
    expect(reqs).toEqual([slideEditUserPrompt(slideMd, describeEditableFields(s), "売上を 120 に", describeEditableData(s))]);
  });
});
