/**
 * structure-ops.test.ts — Theme 3 / S4: surgical slide structure ops (src/mcp/structure.ts). The
 * value prop vs set_deck_markdown (whole-deck regen that DROPS figures) is that insert/delete/move/
 * duplicate touch only the deck.slides array, so the surviving slides' figures stay intact. Locks:
 * insert/delete/move/duplicate mechanics, last-slide delete reject, from===to no-op, deep-clone
 * fidelity, and figure preservation across all of them. See docs/design/mcp-brushup.md §B.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as S from "../src/mcp/session";
import * as St from "../src/mcp/structure";
import { buildServer } from "../src/mcp/server";
import { DocRegistry, type HostContext } from "../src/mcp/host-core";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"));
});

// A 3-slide deck (A / B / C) with a NATIVE diagram grafted onto slide 1 (B), to prove figures survive.
async function deckWithDiagram() {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, "# A\n\n---\n\n# B\n\n---\n\n# C");
  s.deck = {
    ...s.deck!,
    slides: s.deck!.slides.map((sl, k) => (k === 1 ? { ...sl, diagram: { yaml: "type: flowchart\nnodes:\n  - id: a\n    label: A\n", placeholderIdx: "1" } } : sl)),
  };
  return s;
}

describe("insert_slide", () => {
  it("inserts a new slide after index, grows the deck, and preserves neighbours' figures", async () => {
    const s = await deckWithDiagram();
    const before = s.deck!.slides.length;
    const r = St.insertSlide(s, 0, "# 新規\n\n- 追加", "after");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.insertedIndex).toBe(1);
    expect(r.slideCount).toBe(before + 1);
    expect(r.insertedMd).toContain("新規");
    expect("budget" in r).toBe(true);
    expect(s.deck!.slides[2].diagram).toBeTruthy(); // the diagram (was slide 1) shifted to 2 and survived
  });

  it("rejects multi-slide Markdown never-silently (insert takes exactly one slide)", async () => {
    const s = await deckWithDiagram();
    const r = St.insertSlide(s, 0, "# One\n\n---\n\n# Two", "after"); // 2 slides — must not silently drop the 2nd
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1枚|複数|2枚/);
  });
});

describe("delete_slide", () => {
  it("removes a slide, returns its Markdown, and keeps the rest (figures intact)", async () => {
    const s = await deckWithDiagram();
    const before = s.deck!.slides.length;
    const r = St.deleteSlide(s, 2); // "# C" (a non-first slide serializes its title; index-0 is a known empty-serialize edge)
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deletedMd).toContain("C");
    expect(r.slideCount).toBe(before - 1);
    expect(s.deck!.slides[1].diagram).toBeTruthy(); // the diagram on slide 1 is unaffected by deleting slide 2
  });

  it("rejects deleting the LAST remaining slide never-silently", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# Only");
    expect(s.deck!.slides.length).toBe(1);
    const r = St.deleteSlide(s, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/最後の1枚/);
  });

  it("throws on an out-of-range index", async () => {
    const s = await deckWithDiagram();
    expect(() => St.deleteSlide(s, 99)).toThrow(/範囲外/);
  });
});

describe("move_slide", () => {
  it("reorders slides while preserving the moved slide's figure", async () => {
    const s = await deckWithDiagram(); // diagram on slide 1
    const r = St.moveSlide(s, 1, 0); // move the diagram slide to the front
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changed).toBe(true);
    expect(s.deck!.slides[0].diagram).toBeTruthy();
  });

  it("from===to is a surfaced no-op (changed:false), not an error", async () => {
    const s = await deckWithDiagram();
    const r = St.moveSlide(s, 1, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changed).toBe(false);
  });
});

describe("duplicate_slide", () => {
  it("deep-clones a slide (figure survives on BOTH copies, distinct objects)", async () => {
    const s = await deckWithDiagram(); // diagram on slide 1
    const before = s.deck!.slides.length;
    const r = St.duplicateSlide(s, 1, "after");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newIndex).toBe(2);
    expect(r.slideCount).toBe(before + 1);
    expect(s.deck!.slides[1].diagram?.yaml).toBe(s.deck!.slides[2].diagram?.yaml); // both carry the figure
    expect(s.deck!.slides[1].diagram).not.toBe(s.deck!.slides[2].diagram); // deep clone → distinct objects
  });
});

describe("registration", () => {
  it("all 4 structure tools are registered on the MCP server", async () => {
    const server = buildServer(S.createSession(null));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1.0.0" });
    await client.connect(ct);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["insert_slide", "delete_slide", "move_slide", "duplicate_slide"]) expect(names).toContain(n);
  });
});

describe("host mode — structure ops commit through commitMutation (rev/undo), no-op does not", () => {
  function makeHost(): HostContext {
    const registry = new DocRegistry();
    let activeDocId: string | undefined;
    return { registry, active: () => activeDocId, setActive: (_e, id) => { activeDocId = id; }, sharedOnly: false };
  }
  async function hostClient() {
    const host = makeHost();
    const server = buildServer(S.createSession(null), { host });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1.0.0" });
    await client.connect(ct);
    return client;
  }
  async function callData(client: Client, name: string, args: Record<string, unknown> = {}) {
    const res = (await client.callTool({ name, arguments: args })) as unknown as { content: { text?: string }[] };
    return JSON.parse(res.content[0]?.text ?? "null") as { rev?: number; slideCount?: number; changed?: boolean };
  }

  it("insert_slide bumps rev; a from===to move_slide is a no-op (rev unchanged)", async () => {
    const client = await hostClient();
    const created = await callData(client, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: "# A\n\n---\n\n# B" });
    const ins = await callData(client, "insert_slide", { index: 0, markdown: "# 新規", position: "after" });
    expect(ins.rev).toBe(1); // committed
    expect(ins.slideCount).toBe((created.slideCount ?? 0) + 1);
    const noop = await callData(client, "move_slide", { fromIndex: 0, toIndex: 0 });
    expect(noop.changed).toBe(false);
    expect(noop.rev).toBeUndefined(); // no-op result carries no rev (commitMutation did not bump)
  });
});
