/**
 * deck-title.test.ts — B4 (other-AI report): a host-minted doc (an AI's new_project) must derive its
 * tab TITLE from the deck's first-slide heading instead of always showing "Untitled". Covers the pure
 * `deckTitle` helper AND the real MCP host path (new_project → registry entry title).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { deckTitle } from "../src/engine/md-serializer";
import type { DeckIR } from "../src/engine/slide-schema";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabClient } from "../src/ipc/collab-client";

const titleSlide = (idx: string, title: string): DeckIR =>
  ({ slides: [{ placeholders: [{ idx, paragraphs: [{ segments: [{ text: title }] }] }] }] }) as unknown as DeckIR;

describe("deckTitle (pure)", () => {
  it("reads the first slide's title from the title namespace (idx 0)", () => {
    expect(deckTitle(titleSlide("0", "2026年度 事業計画"))).toBe("2026年度 事業計画");
  });
  it("falls back to the content namespace (idx 15) when there is no idx-0 title", () => {
    expect(deckTitle(titleSlide("15", "四半期レビュー"))).toBe("四半期レビュー");
  });
  it("prefers the title namespace (idx 0) over the content namespace when both exist", () => {
    const deck = { slides: [{ placeholders: [
      { idx: "0", paragraphs: [{ segments: [{ text: "表紙タイトル" }] }] },
      { idx: "15", paragraphs: [{ segments: [{ text: "別" }] }] },
    ] }] } as unknown as DeckIR;
    expect(deckTitle(deck)).toBe("表紙タイトル");
  });
  it("takes only the first non-empty line", () => {
    expect(deckTitle(titleSlide("0", "  \nメインタイトル\nサブ"))).toBe("メインタイトル");
  });
  it("returns undefined for an empty deck, a title-less slide, or blank text", () => {
    expect(deckTitle({ slides: [] } as unknown as DeckIR)).toBeUndefined();
    expect(deckTitle(null)).toBeUndefined();
    expect(deckTitle(titleSlide("15", "   "))).toBeUndefined();
    expect(deckTitle({ slides: [{ placeholders: [] }] } as unknown as DeckIR)).toBeUndefined();
  });
});

describe("host new_project → tab title (real MCP path)", () => {
  let templateB64: string;
  let host: CollabHost;
  let ai: CollabClient | undefined;
  beforeAll(() => {
    templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
  });
  afterEach(async () => {
    try { await ai?.close(); } catch { /* ignore */ }
    ai = undefined;
    await host?.close();
  });

  it("names the minted doc after the markdown's first heading (not 'Untitled')", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null });
    ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await ai.connect();
    const made = await ai.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: "# 新製品ローンチ計画\n\n- 市場投入は Q3" });
    const entry = host.registry.list().find((d) => d.docId === made.docId)!;
    expect(entry.title).toBe("新製品ローンチ計画");
    expect(entry.title).not.toBe("Untitled");
  });

  it("falls back to 'Untitled' when the deck has no heading", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null });
    ai = new CollabClient({ url: host.url, token: host.token, role: "ai" });
    await ai.connect();
    const made = await ai.callTool<{ docId: string }>("new_project", { templateBase64: templateB64, markdown: "" });
    const entry = host.registry.list().find((d) => d.docId === made.docId)!;
    expect(entry.title).toBe("Untitled");
  });
});
