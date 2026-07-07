/**
 * mutation-envelope.test.ts — Theme 3 / S3: the 6 deterministic mutations converge to ONE sibling
 * envelope { ok, changed, beforeMd?, afterMd?, diagnostics, budget?, skipped? }, and commitMutation
 * treats changed:false as a NO-OP (fixes the collab bug where a no-op mutation still bumped rev /
 * pushed undo / fired deckChanged). See docs/design/mcp-brushup.md §A + ADR-0015 decision 1.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import { DocRegistry, commitMutation } from "../src/mcp/host-core";
import { autoSelectLayout } from "../src/engine/template-loader";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

async function opened() {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 比較\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n- 価格: 1200円");
  return s;
}

describe("S3 uniform mutation envelope — changed + diagnostics + budget on every mutation", () => {
  it("set_slide_markdown → changed + diagnostics + budget", async () => {
    const s = await opened();
    const r = S.applySlideMarkdown(s, 1, "# 差替\n\n- 一点");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.diagnostics).toBeDefined();
    expect("budget" in r).toBe(true);
  });

  it("set_deck_markdown → changed + diagnostics + budget", async () => {
    const s = await opened();
    const r = S.applyDeckMarkdown(s, "# A\n\n---\n\n# B\n\n- x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.changed).toBe("boolean");
    expect(r.diagnostics).toBeDefined();
    expect("budget" in r).toBe(true);
  });

  it("split_overflowing_slides → changed (+ keeps before/after counts)", async () => {
    const s = await opened();
    const r = S.distill(s);
    expect(r.ok).toBe(true);
    expect(typeof r.changed).toBe("boolean");
    expect(r.after).toBeGreaterThanOrEqual(r.before);
    expect(r.diagnostics).toBeDefined();
  });

  it("convert_bullets_to_table applicable → changed:true + diagnostics", async () => {
    const s = await opened();
    const r = S.visualizeKeyValue(s, 1);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.changed) throw new Error("expected an applied conversion");
    expect(r.afterMd).toContain("|");
    expect(r.diagnostics).toBeDefined();
  });

  it("convert_bullets_to_table NOT applicable → ok:true, changed:false, status:not-applicable (no error mask)", async () => {
    const s = await opened();
    const r = S.visualizeKeyValue(s, 0); // cover: no key-value run
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    if (!r.changed) expect(r.status).toBe("not-applicable");
  });
});

describe("S3 commitMutation — changed:false is a no-op (does NOT bump rev / push undo)", () => {
  async function freshDoc(reg: DocRegistry) {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 中身\n\n- x");
    return reg.create(s, "t", true);
  }

  it("a handler reporting changed:false does not commit", async () => {
    const reg = new DocRegistry();
    const e = await freshDoc(reg);
    expect(e.rev).toBe(0);
    const r = await commitMutation(e, () => ({ ok: true as const, changed: false as const }));
    expect(r.changed).toBe(false);
    expect(e.rev).toBe(0);
    expect(e.history.past.length).toBe(0);
  });

  it("a handler reporting changed:true commits (rev + history)", async () => {
    const reg = new DocRegistry();
    const e = await freshDoc(reg);
    const r = await commitMutation(e, (s) => {
      s.deck = { ...s.deck! };
      return { ok: true as const, changed: true as const };
    });
    expect(r.changed).toBe(true);
    expect(e.rev).toBe(1);
    expect(e.history.past.length).toBe(1);
  });

  it("a real no-op design intent (unknown nodeId) reports changed:false and does not commit", async () => {
    const reg = new DocRegistry();
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 図\n\n- x");
    const i = s.deck!.slides.length - 1;
    s.deck = {
      ...s.deck!,
      slides: s.deck!.slides.map((sl, k) => (k === i ? { ...sl, mermaidBlock: { mermaid: "flowchart TD\n  A[開始]-->B[終了]", placeholderIdx: "1" } } : sl)),
    };
    S.setDiagram(s, i, "flowchart TD\n  A[開始]-->B[終了]", "mermaid"); // graduate to a native diagram
    const e = reg.create(s, "t", true);
    expect(e.rev).toBe(0);
    const r = await commitMutation(e, (ss) => S.applyDesignIntent(ss, i, '[{"op":"emphasize","nodeId":"__nonexistent__"}]'));
    expect((r.result as { changed?: boolean }).changed).toBe(false);
    expect(e.rev).toBe(0);
    expect(e.history.past.length).toBe(0);
    // invariant preserved even though the no-op handler reassigned session.deck to a content-equal object
    expect(e.history.present).toBe(e.session.deck);
  });

  it("a design edit that serializes IDENTICALLY (moves layout/placeholderIdx) still commits — NOT discarded (regression)", async () => {
    // The lossy case: serializeMd drops a figure's placeholderIdx and re-resolves layout:"auto", so a
    // regionSplit whose only visible-in-Markdown effect is nil would falsely read as changed:false and
    // commitMutation's re-sync would silently revert it. The fix computes `changed` structurally.
    const reg = new DocRegistry();
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n# 図");
    const i = s.deck!.slides.length - 1;
    const catalog = S.getCatalog(s).entries;
    const slide0 = { ...s.deck!.slides[i], diagram: { yaml: "type: flowchart\nnodes:\n  - id: a\n    label: A\n", placeholderIdx: "1" } };
    // PIN the layout to what auto resolves to, so regionSplit's layout:"auto" re-resolves to the SAME
    // name → byte-identical Markdown (the exact blind spot). diagram-only changes ONLY the layout field.
    const resolved = autoSelectLayout(slide0, i, s.deck!.slides.length, catalog);
    s.deck = { ...s.deck!, slides: s.deck!.slides.map((sl, k) => (k === i ? { ...slide0, layout: resolved } : sl)) };
    const e = reg.create(s, "t", true);
    const r = await commitMutation(e, (ss) => S.applyDesignIntent(ss, i, '[{"op":"regionSplit","arrangement":"diagram-only"}]'));
    const res = r.result as { changed: boolean; beforeMd: string; afterMd: string };
    expect(res.beforeMd).toBe(res.afterMd); // Markdown IS byte-identical (the lossy case)
    expect(res.changed).toBe(true); // ...but the structural change (layout → "auto") is still detected
    expect(r.changed).toBe(true); // committed, not discarded
    expect(e.rev).toBe(1);
    expect(e.session.deck!.slides[i].layout).toBe("auto"); // the edit PERSISTED (not reverted by re-sync)
  });
});
