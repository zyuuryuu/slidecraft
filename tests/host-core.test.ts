/**
 * host-core.test.ts — the P2 multi-doc registry + server-side undo, driven DIRECTLY (no MCP
 * transport). Proves: unique docIds + private-by-default listing + per-doc isolation;
 * commitMutation bumps rev/pushes history on success but NOT on a {ok:false} reject;
 * undo/redo roll the truth back while minting a NEW forward rev; and the
 * history.present === session.deck invariant after every op.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { bundleProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import * as S from "../src/mcp/session";
import { DocRegistry, commitMutation, undoDoc, redoDoc, type DocEntry } from "../src/mcp/host-core";

const DECK_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";

let bundle: Uint8Array;
beforeAll(async () => {
  const tBytes = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"));
  const template = await loadTemplate(tBytes);
  bundle = await bundleProject(parseMd(DECK_MD), template, { templateName: "T", savedAt: "2026-06-29T00:00:00Z" });
});

/** an opened Session wrapped in a fresh registry entry */
async function freshDoc(reg: DocRegistry, title = "doc", shared = true): Promise<DocEntry> {
  const s = S.createSession(null);
  await S.openProjectBytes(s, bundle);
  return reg.create(s, title, shared);
}

describe("DocRegistry", () => {
  it("mints unique docIds and resolves / removes them (never-silent on miss)", async () => {
    const reg = new DocRegistry();
    const a = await freshDoc(reg, "A");
    const b = await freshDoc(reg, "B");
    expect(a.docId).not.toEqual(b.docId);
    expect(reg.size).toBe(2);
    expect(reg.get(a.docId)).toBe(a);
    expect(reg.has(b.docId)).toBe(true);
    reg.remove(a.docId);
    expect(reg.has(a.docId)).toBe(false);
    expect(() => reg.get(a.docId)).toThrow(/見つかりません/);
  });

  it("soleDocId returns the id only when exactly one doc is open", async () => {
    const reg = new DocRegistry();
    expect(reg.soleDocId()).toBeNull();
    const a = await freshDoc(reg);
    expect(reg.soleDocId()).toBe(a.docId);
    await freshDoc(reg);
    expect(reg.soleDocId()).toBeNull(); // ambiguous → caller must select
  });

  it("list honours private-by-default (sharedOnly filters out human-private docs)", async () => {
    const reg = new DocRegistry();
    const shared = await freshDoc(reg, "shared", true);
    await freshDoc(reg, "private", false);
    expect(reg.list().length).toBe(2);
    const visible = reg.list({ sharedOnly: true });
    expect(visible.map((d) => d.docId)).toEqual([shared.docId]);
  });
});

describe("commitMutation", () => {
  it("a successful mutation bumps rev, pushes history, and keeps present === session.deck", async () => {
    const reg = new DocRegistry();
    const e = await freshDoc(reg);
    expect(e.rev).toBe(0);
    const r = await commitMutation(e, (s) => S.applySlideMarkdown(s, 1, "# 差替\n\n- 一点"));
    expect(r.changed).toBe(true);
    expect(e.rev).toBe(1);
    expect(e.history.past.length).toBe(1);
    expect(e.history.present).toBe(e.session.deck); // invariant
  });

  it("a {ok:false} reject does NOT bump rev or push history (never-silent = no change)", async () => {
    const reg = new DocRegistry();
    const e = await freshDoc(reg);
    // slide 0 is the figureless cover → setDiagram rejects with {ok:false}
    const r = await commitMutation(e, (s) => S.setDiagram(s, 0, "flowchart TD\n  A-->B", "mermaid"));
    expect(r.changed).toBe(false);
    expect(e.rev).toBe(0);
    expect(e.history.past.length).toBe(0);
  });
});

describe("undo / redo", () => {
  it("undo rolls the deck back and mints a NEW forward rev; redo restores it", async () => {
    const reg = new DocRegistry();
    const e = await freshDoc(reg);
    const deck0 = e.session.deck;
    await commitMutation(e, (s) => S.applySlideMarkdown(s, 1, "# 差替\n\n- 一点")); // rev 1, deck1
    const deck1 = e.session.deck;
    expect(deck1).not.toBe(deck0);

    const u = undoDoc(e);
    expect(u.ok).toBe(true);
    expect(e.rev).toBe(2); // forward-only: undo mints a higher rev
    expect(e.session.deck).toBe(deck0); // truth rolled back
    expect(e.history.present).toBe(e.session.deck); // invariant
    expect(u.canUndo).toBe(false);
    expect(u.canRedo).toBe(true);

    const rd = redoDoc(e);
    expect(rd.ok).toBe(true);
    expect(e.rev).toBe(3);
    expect(e.session.deck).toBe(deck1);
    expect(rd.canRedo).toBe(false);
  });

  it("undo/redo with nothing to do is a never-silent no-op (ok:false + reason)", async () => {
    const reg = new DocRegistry();
    const e = await freshDoc(reg);
    const u = undoDoc(e);
    expect(u.ok).toBe(false);
    expect(u.reason).toBe("nothing-to-undo");
    expect(e.rev).toBe(0);
    const rd = redoDoc(e);
    expect(rd.ok).toBe(false);
    expect(rd.reason).toBe("nothing-to-redo");
  });
});

describe("per-doc isolation", () => {
  it("a mutation on one doc leaves the other's rev and history untouched", async () => {
    const reg = new DocRegistry();
    const a = await freshDoc(reg, "A");
    const b = await freshDoc(reg, "B");
    await commitMutation(a, (s) => S.applySlideMarkdown(s, 1, "# A だけ\n\n- x"));
    expect(a.rev).toBe(1);
    expect(b.rev).toBe(0);
    expect(b.history.past.length).toBe(0);
  });
});
