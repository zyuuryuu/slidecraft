/**
 * mcp-deck-image.test.ts — #522: `get_deck_html` / `get_deck_image` return the WHOLE deck as ONE
 * contact sheet (a grid of slide thumbnails, each labeled with its 0-based index) so the upstream
 * AI's finishing check is one round trip instead of one `get_slide_image` per slide (ADR-0037 D3:
 * a tool is added only when it removes hot-loop round trips — 29 → 1 measured in #516).
 *
 * Invariants locked here:
 *  - R8 (no second render path): every cell's slide markup is BYTE-IDENTICAL to the <body> of
 *    `get_slide_html(i)` — the sheet is `renderSlideHtml`'s body laid out in a grid and shot once
 *    with the existing rasterizer; no compositing library, no per-slide screenshot stitching.
 *  - the sheet is as script-free / network-dead as the single-slide page (same CSP).
 *  - sizing is a pure plan (`planDeckSheet`): a pixel budget shrinks the sheet so 30 slides stay
 *    within a few MB; `start`/`maxSlides` window the deck and truncation is reported, never silent.
 *  - browser absence fails with the SAME never-silent `browser-not-found` as get_slide_image.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession, newProject, type Session } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { GuardError } from "../src/mcp/guard-errors";
import { findBrowser, renderSlideHtml, renderDeckHtml, rasterizeDeck, planDeckSheet, DECK_SHEET } from "../src/mcp/slide-raster";

const TEMPLATE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const MD3 = "# 四半期経営レビュー\n> 経営企画部\n\n---\n\n# 現状分析\n\n- 売上高は前年比120%で推移\n- 新規顧客が32社増加\n\n---\n\n# 来期の重点施策\n\n- 既存顧客の深耕\n- 新チャネル開拓";

// Same CI gating as mcp-slide-image.test.ts (#281): real-browser blocks run locally and in the
// non-required browser-smoke job only. SLIDECRAFT_BROWSER picks the binary (findBrowser honors it),
// e.g. a Playwright chrome-headless-shell where the system Chrome's --screenshot path is unusable.
const TEST_BROWSER = findBrowser()?.path;
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const IS_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const REAL_BROWSER = !!TEST_BROWSER && (!IS_CI || process.env.SLIDECRAFT_E2E_BROWSER === "1");

const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});
function browserEnv(): void {
  setEnv("SLIDECRAFT_BROWSER", TEST_BROWSER);
  if (AS_ROOT) setEnv("SLIDECRAFT_BROWSER_NO_SANDBOX", "1");
}

let templateBytes: Uint8Array;
beforeAll(() => {
  templateBytes = new Uint8Array(readFileSync(TEMPLATE));
});

async function loadedSession(md = MD3): Promise<Session> {
  const s = createSession(null);
  await newProject(s, templateBytes, md);
  return s;
}

async function connect(): Promise<Client> {
  const server = buildServer(createSession(null));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

/** The slide markup between <body> and </body> of a single-slide page. */
function bodyOf(page: string): string {
  const m = /<body>([\s\S]*)<\/body>/.exec(page);
  if (!m) throw new Error("no <body> in page");
  return m[1];
}

function pngInfo(bytes: Buffer): { isPng: boolean; w: number; h: number } {
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { isPng, w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

describe("planDeckSheet (pure sizing plan)", () => {
  it("defaults: all slides from 0, DECK_SHEET.columns columns (clamped to the count), cells fill the sheet width, meta is exact", () => {
    const p = planDeckSheet(3, {});
    expect(p.from).toBe(0);
    expect(p.count).toBe(3);
    expect(p.total).toBe(3);
    expect(p.truncated).toBe(false);
    expect(p.columns).toBe(Math.min(DECK_SHEET.columns, 3)); // a short deck gets bigger cells, not empty columns
    expect(p.rows).toBe(1);
    expect(planDeckSheet(12, {}).columns).toBe(DECK_SHEET.columns);
    expect(p.cellW * p.columns).toBeLessThanOrEqual(p.width);
    expect(p.cellH).toBe(Math.round((p.cellW * 720) / 1280)); // 16:9 cells
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(p.cellH);
  });

  it("start/maxSlides window the deck and report truncation (never silent)", () => {
    const p = planDeckSheet(35, { start: 10, maxSlides: 5 });
    expect(p).toMatchObject({ from: 10, count: 5, total: 35, truncated: true });
    const tail = planDeckSheet(35, { start: 33 });
    expect(tail).toMatchObject({ from: 33, count: 2, total: 35, truncated: false });
    // the default window caps a long deck at DECK_SHEET.maxSlides and says so
    const long = planDeckSheet(DECK_SHEET.maxSlides + 7, {});
    expect(long).toMatchObject({ from: 0, count: DECK_SHEET.maxSlides, truncated: true });
  });

  it("pixel budget: a tall layout (few columns × many slides) shrinks the sheet instead of exploding", () => {
    const wide = planDeckSheet(30, { columns: 5 });
    const narrow = planDeckSheet(30, { columns: 2 });
    expect(wide.width * wide.height).toBeLessThanOrEqual(DECK_SHEET.pixelBudget);
    expect(narrow.width * narrow.height).toBeLessThanOrEqual(DECK_SHEET.pixelBudget);
    expect(narrow.width).toBeLessThan(wide.width); // shrunk to honor the budget
    // the dimensions the browser is asked for are exactly what the plan says (whole pixels)
    for (const p of [wide, narrow]) {
      expect(Number.isInteger(p.width) && Number.isInteger(p.height)).toBe(true);
      expect(p.width).toBeLessThanOrEqual(DECK_SHEET.maxWidth);
    }
  });

  it("guards: bad start / columns / maxSlides are modeled GuardErrors", () => {
    expect(() => planDeckSheet(3, { start: 3 })).toThrow(GuardError);
    expect(() => planDeckSheet(3, { start: -1 })).toThrow(GuardError);
    expect(() => planDeckSheet(3, { columns: 0 })).toThrow(GuardError);
    expect(() => planDeckSheet(3, { maxSlides: 0 })).toThrow(GuardError);
  });
});

describe("renderDeckHtml — ONE contact-sheet page built from renderSlideHtml's bodies (R8)", () => {
  it("3-slide deck: 3 labeled cells, each cell's slide markup == get_slide_html(i)'s <body>, in order", async () => {
    const s = await loadedSession();
    const { html, meta } = renderDeckHtml(s, {});
    expect(meta).toMatchObject({ from: 0, count: 3, total: 3, truncated: false });

    let cursor = 0;
    for (let i = 0; i < 3; i++) {
      const single = bodyOf(renderSlideHtml(s, i));
      const cell = html.indexOf(`data-i="${i}"`, cursor);
      expect(cell, `cell ${i} present after cell ${i - 1}`).toBeGreaterThanOrEqual(cursor);
      const body = html.indexOf(single, cell);
      expect(body, `cell ${i} carries get_slide_html(${i})'s exact body`).toBeGreaterThan(cell);
      expect(html.slice(cell, body)).toContain(`>${i}<`); // the 0-based index label precedes the slide
      cursor = body + single.length;
    }
    expect(html.match(/data-i="/g)?.length).toBe(3); // exactly the deck's cells, no extras
    expect(html).toContain("売上高は前年比120%で推移"); // slide 1's text
    expect(html).toContain("新チャネル開拓"); // slide 2's text
  });

  it("same confinement as the single-slide page: no <script>, same CSP, fonts embedded once, whole-pixel body", async () => {
    const s = await loadedSession();
    const { html, meta } = renderDeckHtml(s, {});
    expect(html).not.toContain("<script");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html.match(/@font-face/g)?.length).toBe(renderSlideHtml(s, 0).match(/@font-face/g)?.length); // not N copies
    expect(html).toContain(`width:${meta.width}px;height:${meta.height}px`);
  });

  it("windowing: start/maxSlides select the cells; labels keep the ABSOLUTE 0-based index", async () => {
    const s = await loadedSession();
    const { html, meta } = renderDeckHtml(s, { start: 1, maxSlides: 1 });
    expect(meta).toMatchObject({ from: 1, count: 1, total: 3, truncated: true });
    expect(html.match(/data-i="/g)?.length).toBe(1);
    expect(html).toContain('data-i="1"');
    expect(html).toContain(bodyOf(renderSlideHtml(s, 1)));
    expect(html).not.toContain("新チャネル開拓"); // slide 2 is outside the window
  });

  it("guards: unopened project / out-of-range start are modeled errors", async () => {
    expect(() => renderDeckHtml(createSession(null), {})).toThrow(GuardError);
    const s = await loadedSession();
    expect(() => renderDeckHtml(s, { start: 99 })).toThrow(GuardError);
  });
});

describe("never-silent browser absence (same contract as get_slide_image)", () => {
  it("rasterizeDeck with no discoverable browser → GuardError browser-not-found", async () => {
    setEnv("SLIDECRAFT_BROWSER", undefined);
    setEnv("SLIDECRAFT_BROWSER_CANDIDATES", "/nonexistent/a:/nonexistent/b");
    const s = await loadedSession();
    await expect(rasterizeDeck(s, {})).rejects.toMatchObject({ code: "browser-not-found" });
  });
});

describe("MCP tool get_deck_html (end to end over the protocol)", () => {
  it("returns { html, ...meta }; html carries every slide's body (R8 agreement with get_slide_html)", async () => {
    const client = await connect();
    await client.callTool({ name: "new_project", arguments: { templateBase64: Buffer.from(templateBytes).toString("base64"), markdown: MD3 } });
    const res = (await client.callTool({ name: "get_deck_html", arguments: {} })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    expect(res.isError).toBeFalsy();
    const r = JSON.parse(res.content[0]!.text!) as { html: string; from: number; count: number; total: number; truncated: boolean; width: number; height: number };
    expect(r).toMatchObject({ from: 0, count: 3, total: 3, truncated: false });
    for (let i = 0; i < 3; i++) {
      const single = (await client.callTool({ name: "get_slide_html", arguments: { index: i } })) as { content: Array<{ text?: string }> };
      expect(r.html).toContain(bodyOf(JSON.parse(single.content[0]!.text!) as string));
    }
  });

  it("out-of-range start → modeled { ok:false, code:'index-out-of-range' }", async () => {
    const client = await connect();
    await client.callTool({ name: "new_project", arguments: { templateBase64: Buffer.from(templateBytes).toString("base64"), markdown: MD3 } });
    const bad = (await client.callTool({ name: "get_deck_html", arguments: { start: 99 } })) as { content: Array<{ text?: string }>; isError?: boolean };
    expect(bad.isError).toBeFalsy();
    expect(JSON.parse(bad.content[0]!.text!)).toMatchObject({ ok: false, code: "index-out-of-range" });
  });
});

describe.skipIf(!REAL_BROWSER)("real headless rasterization of the contact sheet", () => {
  it("rasterizeDeck: ONE PNG whose dimensions equal the plan's, with visible ink", { timeout: 90_000, retry: 2 }, async () => {
    browserEnv();
    const s = await loadedSession();
    const img = await rasterizeDeck(s, {});
    const bytes = Buffer.from(img.pngBase64, "base64");
    const { isPng, w, h } = pngInfo(bytes);
    expect(isPng).toBe(true);
    expect(w).toBe(img.width);
    expect(h).toBe(img.height);
    expect(img).toMatchObject({ from: 0, count: 3, total: 3, truncated: false });
    expect(bytes.length).toBeGreaterThan(20_000); // three real thumbnails, not a blank sheet
  });

  it("MCP get_deck_image: image content + ONE compact meta text; guards surface as modeled errors", { timeout: 90_000, retry: 2 }, async () => {
    browserEnv();
    const client = await connect();
    await client.callTool({ name: "new_project", arguments: { templateBase64: Buffer.from(templateBytes).toString("base64"), markdown: MD3 } });
    const res = (await client.callTool({ name: "get_deck_image", arguments: { columns: 3 } })) as {
      content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.type).toBe("image");
    expect(res.content[0]?.mimeType).toBe("image/png");
    expect(pngInfo(Buffer.from(res.content[0]!.data!, "base64")).isPng).toBe(true);
    expect(res.content[1]?.type).toBe("text");
    expect(JSON.parse(res.content[1]!.text!)).toMatchObject({ from: 0, count: 3, total: 3, columns: 3, truncated: false });

    const bad = (await client.callTool({ name: "get_deck_image", arguments: { start: 99 } })) as { content: Array<{ text?: string }>; isError?: boolean };
    expect(bad.isError).toBeFalsy();
    expect(JSON.parse(bad.content[0]!.text!)).toMatchObject({ ok: false, code: "index-out-of-range" });
  });
});
