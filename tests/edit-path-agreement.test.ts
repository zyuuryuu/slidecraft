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
import * as S from "../src/mcp/session";
import { applyFigureYaml, reconcileSlideEdit } from "../src/engine/ai-apply";
import { distillDeck } from "../src/engine/distill";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR } from "../src/engine/slide-schema";

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

describe("#220 KNOWN DIVERGENCE (統括裁定待ち): add a figure to a pinned slide whose body is EMPTY", () => {
  // MCP keeps the pin (it validated the body ordinal against THAT resolved layout); the GUI re-autos the
  // layout. Pinned exactly so a change on either side is a deliberate, reviewed edit of this list.
  it("MCP keeps layout pin, GUI resets to auto — otherwise identical", async () => {
    const { s, old } = await session((sl) => ({ ...bodyless(sl), layout: "Content.1Body.Single" }));
    const gui = applyFigureYaml(old, NEW_YAML)!;
    expect(S.setDiagram(s, 1, NEW_YAML, "yaml").ok).toBe(true);
    const mcp = s.deck!.slides[1];
    expect(mcp.layout).toBe("Content.1Body.Single");
    expect(gui.layout).toBe("auto");
    expect({ ...mcp, layout: "auto" }).toEqual(gui);
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

  // KNOWN DIVERGENCES (統括裁定待ち): the GUI door runs reconcileEdit (structure restore + table/code carry +
  // broken-figure drop + meltdown guard); the MCP door only carries diagram/mermaid. Pinned per-door.
  it("KNOWN DIVERGENCE: edit drops the title — GUI restores it, MCP applies the drop", async () => {
    const { s, old } = await session();
    const gui = reconcileSlideEdit(old, "- 一だけ", tplOf(s))!;
    S.applySlideMarkdown(s, 1, "- 一だけ");
    const title = (sl: SlideIR) => sl.placeholders.find((p) => p.idx === "15");
    expect(title(gui.slide)?.paragraphs[0].segments[0].text).toBe("中身");
    expect(title(s.deck!.slides[1])).toBeUndefined();
  });
  it("KNOWN DIVERGENCE: edit omits the table — GUI carries it, MCP drops it", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 中身\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    const old = s.deck!.slides[1];
    expect(old.table).toBeDefined();
    const gui = reconcileSlideEdit(old, "# 中身\n\n- 表は消した", tplOf(s))!;
    S.applySlideMarkdown(s, 1, "# 中身\n\n- 表は消した");
    expect(gui.slide.table).toEqual(old.table);
    expect(s.deck!.slides[1].table).toBeUndefined();
  });
  it("KNOWN DIVERGENCE: edit carries a BROKEN diagram — GUI keeps the old valid one, MCP stores the broken YAML", async () => {
    const { s, old } = await session((sl) => ({ ...sl, diagram: { yaml: OLD_YAML, placeholderIdx: "2" } }));
    const edit = "# 中身\n\n- 一\n\n```diagram\ntype: flowchart\nnodes: [oops\n```";
    const gui = reconcileSlideEdit(old, edit, tplOf(s))!;
    S.applySlideMarkdown(s, 1, edit);
    expect(gui.slide.diagram?.yaml).toBe(OLD_YAML);
    expect(s.deck!.slides[1].diagram?.yaml).toBe("type: flowchart\nnodes: [oops");
  });
  it("KNOWN DIVERGENCE: a content-less edit — GUI keeps the old slide (meltdown guard), MCP empties it", async () => {
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
