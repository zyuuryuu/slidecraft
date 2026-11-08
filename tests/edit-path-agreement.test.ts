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
import { routeDataEdit } from "../src/engine/chart-edit-ops";
import { DiagramSpecSchema } from "../src/engine/schema";
import { loadYaml } from "../src/engine/yaml-io";

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
});

// ── #106 P2: placeholder TEXT edits — the AI setField ops door ≡ the GUI field-editor door ──
// Both write one placeholder's text through applyFieldEdit(textToParagraphs(text)): the field editor
// (SlideEditor.updatePlaceholder) by hand, the AI panel (useDeckController handleApplySlide /
// previewSlideEdit → routeFieldEdit) from a setField ops array. No MCP door here (統括裁定 2026-11-07:
// no placeholder-level MCP tool — set_slide_markdown covers it).
describe("#106 P2 delegation: the setField door goes through the field editor's primitive", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../src", p), "utf8");
  it("field-edit-ops.ts applies via applyFieldEdit + textToParagraphs (no own merge)", () => {
    expect(src("engine/field-edit-ops.ts")).toMatch(/import \{[^}]*\bapplyFieldEdit\b[^}]*\} from "\.\/placeholder-binding"/);
    expect(src("engine/field-edit-ops.ts")).toMatch(/import \{[^}]*\btextToParagraphs\b[^}]*\} from "\.\/field-text"/);
    expect(src("components/SlideEditor.tsx")).toMatch(/applyFieldEdit\(slide\.placeholders, idx, textToParagraphs\(text\)\)/);
  });
  it("the GUI controller routes AI output through routeFieldEdit in BOTH apply and preview", () => {
    const ctl = src("components/useDeckController.ts");
    expect(ctl).toMatch(/import \{[^}]*\brouteFieldEdit\b[^}]*\} from "\.\.\/engine\/field-edit-ops"/);
    expect(ctl.match(/\brouteFieldEdit\(/g)?.length).toBe(2);
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
// Markdown editor door (handleSlideMdChange → parseMd of the edited slide Markdown). The GUI routes
// DATA ops right beside setField (routeFieldEdit ?? routeDataEdit). No MCP door (統括裁定: no new tools).
describe("#106 P3 delegation: the GUI controller routes AI output through routeDataEdit in BOTH apply and preview", () => {
  it("routeDataEdit sits beside routeFieldEdit (same result shape, same branch)", () => {
    const ctl = readFileSync(resolve(__dirname, "../src/components/useDeckController.ts"), "utf8");
    expect(ctl).toMatch(/import \{[^}]*\brouteDataEdit\b[^}]*\} from "\.\.\/engine\/chart-edit-ops"/);
    expect(ctl.match(/routeFieldEdit\([^)]*\) \?\? routeDataEdit\(/g)?.length).toBe(2);
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
