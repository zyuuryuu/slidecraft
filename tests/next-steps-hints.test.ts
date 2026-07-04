/**
 * next-steps-hints.test.ts — Theme 3 / S6: deterministic next-step hints (src/mcp/next-steps.ts) +
 * split's changedSlides (distillDeckReport) + the server wiring that rides hints on the mutation
 * envelope / get_deck_issues. Hints are a PURE issue→lever→tool table (same deck → same hints), and
 * split reports the new post-split indices so an index-addressed follow-up isn't stale. See §E.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { nextStepHints } from "../src/mcp/next-steps";
import type { DeckIssue } from "../src/engine/deck-diagnostics";
import * as S from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"));
});

const iss = (slideIndex: number, levers: DeckIssue["levers"], message = "m"): DeckIssue => ({ slideIndex, title: "", level: "warn", message, levers });

describe("nextStepHints — deterministic issue→lever→tool table", () => {
  it("overflow (split lever) → split_overflowing_slides, emitted ONCE for the deck", () => {
    const h = nextStepHints([iss(1, ["split", "condense", "visualize"]), iss(3, ["split", "condense", "visualize"])]);
    expect(h.filter((x) => x.tool === "split_overflowing_slides").length).toBe(1);
  });
  it("key-value (visualize) → convert_bullets_to_table with args.index", () => {
    expect(nextStepHints([iss(2, ["visualize"])])).toEqual([{ slideIndex: 2, tool: "convert_bullets_to_table", reason: "m", args: { index: 2 } }]);
  });
  it("condense / missing-title → get_slide_fix_request(index)", () => {
    const h = nextStepHints([iss(1, ["condense"]), iss(4, ["title"])]);
    expect(h.every((x) => x.tool === "get_slide_fix_request")).toBe(true);
    expect(h.map((x) => x.args?.index)).toEqual([1, 4]);
  });
  it("a clean deck yields no hints", () => {
    expect(nextStepHints([])).toEqual([]);
  });
});

describe("split_overflowing_slides — changedSlides (the new post-split indices)", () => {
  it("reports the indices produced by splitting an overflowing slide", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes, "# 表紙");
    // set an UNDISTILLED deck with a heavily overflowing content slide (applyDeckMarkdown does not distill)
    const bullets = Array.from({ length: 40 }, (_, i) => `- 長い箇条書き項目${i}：容量を超過させるための十分に長いテキストをここに置きます`).join("\n");
    S.applyDeckMarkdown(s, `# 表紙\n\n---\n\n# 中身\n\n${bullets}`);
    const before = s.deck!.slides.length;
    const r = S.distill(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.after).toBeGreaterThan(before);
    expect(r.changedSlides.length).toBeGreaterThan(0);
    for (const idx of r.changedSlides) expect(idx).toBeLessThan(r.after); // valid post-split positions
  });
});

describe("server wiring — hints ride the mutation envelope + get_deck_issues", () => {
  async function connect() {
    const server = buildServer(S.createSession(null));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1.0.0" });
    await client.connect(ct);
    return client;
  }
  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const res = (await client.callTool({ name, arguments: args })) as unknown as { content: { text?: string }[] };
    return JSON.parse(res.content[0]?.text ?? "null") as { hints?: unknown };
  }
  it("get_deck_issues and a mutation both carry a hints array", async () => {
    const client = await connect();
    await call(client, "new_project", { templateBase64: templateBytes.toString("base64"), markdown: "# A\n\n---\n\n# B\n\n- x" });
    const issues = await call(client, "get_deck_issues");
    expect(Array.isArray(issues.hints)).toBe(true);
    const mutated = await call(client, "set_slide_markdown", { index: 1, markdown: "# B\n\n- 一点" });
    expect(Array.isArray(mutated.hints)).toBe(true); // withHints attaches to the mutation envelope's diagnostics
  });
});
