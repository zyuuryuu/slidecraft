/**
 * mcp-slide-image.test.ts — #109: `get_slide_image` renders ONE slide's CURRENT drawing to PNG by
 * screenshotting the SHARED HTML rendering (SlideCard SSR + embedded CJK fonts) in a locally
 * installed, headless Chromium-family browser (方式 A1). Locks the decided contract:
 *   - the page is the shared rendering: SlideCard SSR at 96dpi, fonts embedded → CJK never tofu;
 *   - the page carries ZERO <script> and a CSP forbidding script/network (静的描画で撮る);
 *   - browser DISCOVERY: env override → system Chrome/Edge → null (the tool then fails
 *     NEVER-SILENTLY with guidance — no auto-download, no bundling: security decision in #109);
 *   - rasterization is CONFINED: disposable profile, extensions off, and the network is dead
 *     (proxy to a closed port + DNS mapped to NOTFOUND) — proven by a live listener seeing 0 hits.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { createServer, type Server } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession, newProject } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { GuardError } from "../src/mcp/guard-errors";
import { findBrowser, renderSlideHtml, rasterizeHtml, rasterizeSlide } from "../src/mcp/slide-raster";
import type { Session } from "../src/mcp/session";

const TEMPLATE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const CJK_MD = "# 四半期経営レビュー\n> 経営企画部\n\n---\n\n# 現状分析\n\n- 売上高は前年比120%で推移\n- 新規顧客が32社増加";

// A browser for the REAL rasterization tests: normal discovery first (CI's ubuntu runner has
// /usr/bin/google-chrome), then the local Playwright-provisioned Chromium many dev boxes carry.
// Tests that need a real browser skipIf(!TEST_BROWSER) — same pattern as gitignored-fixture tests.
const PW_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TEST_BROWSER = findBrowser()?.path ?? (existsSync(PW_CHROMIUM) ? PW_CHROMIUM : undefined);
// Chromium's sandbox refuses to run as root without an explicit opt-out; containers often run
// tests as root, so opt out THERE only (never silently baked into the defaults).
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

// #281: the REAL-Chrome rasterization blocks spawn a browser and demand it paint within 30s. Under
// CI-runner load that render can miss the deadline (GuardError raster-timeout) and randomly redden
// the REQUIRED `test` job — a nondeterministic gate on every PR. So keep them OFF the required job:
// they run locally (dev boxes), and in CI only inside the NON-REQUIRED e2e job, opt-in via
// SLIDECRAFT_E2E_BROWSER. The discovery / SSR-page / never-silent assertions below carry no browser
// and stay MANDATORY. GitHub Actions sets CI=true + GITHUB_ACTIONS=true.
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

async function loadedSession(): Promise<Session> {
  const s = createSession(null);
  await newProject(s, templateBytes, CJK_MD);
  return s;
}

function pngInfo(bytes: Buffer): { isPng: boolean; w: number; h: number } {
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { isPng, w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

/** Decode a Chrome-screenshot PNG (8-bit, RGB or RGBA, non-interlaced) and count the pixels that
 *  differ from the image's dominant color — "ink". Compressed-size heuristics proved encoder-
 *  dependent (CI's chrome emitted a far smaller file than the local one for the same content);
 *  counting actual non-background pixels is calibration-free. */
function inkPixels(bytes: Buffer): number {
  const colorType = bytes[25]; // IHDR: 2=RGB, 6=RGBA
  const bpp = colorType === 6 ? 4 : 3;
  const { w, h } = pngInfo(bytes);
  // Concatenate IDAT payloads, inflate, unfilter scanlines (PNG filters 0-4).
  const idat: Buffer[] = [];
  for (let off = 8; off + 8 <= bytes.length; ) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(bytes.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const img = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = img.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? img.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 0xff;
    }
  }
  // Dominant color (sampled) → count pixels that differ from it.
  const counts = new Map<number, number>();
  const key = (i: number) => (img[i] << 16) | (img[i + 1] << 8) | img[i + 2];
  for (let i = 0; i < img.length; i += stride) for (let x = 0; x < stride; x += bpp * 7) counts.set(key(i + x), (counts.get(key(i + x)) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0];
  let ink = 0;
  for (let i = 0; i < img.length; i += bpp) if (key(i) !== dominant) ink++;
  return ink;
}

describe("browser discovery (env → system → null)", () => {
  it("an explicit SLIDECRAFT_BROWSER wins when it exists", () => {
    setEnv("SLIDECRAFT_BROWSER", process.execPath); // any existing executable path
    const found = findBrowser();
    expect(found?.path).toBe(process.execPath);
    expect(found?.source).toBe("env");
  });

  it("an explicit SLIDECRAFT_BROWSER pointing nowhere fails NEVER-SILENTLY (not a fallthrough)", () => {
    setEnv("SLIDECRAFT_BROWSER", "/nonexistent/browser-binary");
    expect(() => findBrowser()).toThrow(GuardError);
  });
});

describe("single-slide page (shared rendering, JS-free)", () => {
  it("SSRs the slide's own text with embedded CJK @font-face and no <script>", async () => {
    const s = await loadedSession();
    const html = renderSlideHtml(s, 1);
    expect(html).toContain("売上高は前年比120%で推移"); // the slide's content, rendered
    expect(html).toContain("@font-face"); // bundled Noto variable font embedded (repo public/fonts)
    expect(html).not.toContain("<script"); // static page — nothing to execute
    expect(html).toContain("script-src 'none'"); // CSP forbids script AND network outright
    expect(html).toContain("default-src 'none'");
  });

  it("guards: out-of-range index and unopened project are modeled errors", async () => {
    const s = await loadedSession();
    expect(() => renderSlideHtml(s, 99)).toThrow(GuardError);
    expect(() => renderSlideHtml(createSession(null), 0)).toThrow(GuardError);
  });
});

describe.skipIf(!REAL_BROWSER)("real headless rasterization", () => {
  it("returns the slide as a real 1280×720 PNG with visible ink (CJK deck)", { timeout: 60_000, retry: 2 }, async () => {
    browserEnv();
    const s = await loadedSession();
    const img = await rasterizeSlide(s, 0);
    const bytes = Buffer.from(img.pngBase64, "base64");
    const { isPng, w, h } = pngInfo(bytes);
    expect(isPng).toBe(true);
    expect(w).toBe(1280);
    expect(h).toBe(720);
    // Real ink (decoded pixels differing from the dominant background), not compressed-size
    // guesswork: the cover's title/subtitle/decorations paint tens of thousands of pixels; a
    // text-less flat render stays near zero.
    expect(inkPixels(bytes)).toBeGreaterThan(10_000);
    // retry: real-Chrome render can transiently miss its deadline under load (#281); a re-spawn
    // clears it. Only reached in the non-required e2e job / locally, never the required `test`.
  });

  it("the network is DEAD during rasterization: a live local listener sees zero connections", { timeout: 60_000, retry: 2 }, async () => {
    browserEnv();
    const hits: string[] = [];
    const listener: Server = createServer((sock) => {
      hits.push("hit");
      sock.destroy();
    });
    await new Promise<void>((res) => listener.listen(0, "127.0.0.1", res));
    const port = (listener.address() as { port: number }).port;
    try {
      const html =
        `<!doctype html><meta charset="utf-8"><body>` +
        `<img src="http://127.0.0.1:${port}/direct-ip.png">` +
        `<img src="http://net-block-probe.invalid/dns.png">` +
        `<div style="width:1280px;height:720px;background:#123456"></div></body>`;
      const png = await rasterizeHtml(TEST_BROWSER!, html);
      expect(pngInfo(png).isPng).toBe(true); // the page still rendered (blocking is silent to the page)
      expect(hits).toEqual([]); // ...but NOTHING reached the wire, even by direct IP
    } finally {
      await new Promise<void>((res) => listener.close(() => res()));
    }
  });
});

describe("never-silent browser absence", () => {
  it("rasterizeSlide with no discoverable browser guides the user (GuardError, not a blank image)", async () => {
    setEnv("SLIDECRAFT_BROWSER", undefined);
    setEnv("SLIDECRAFT_BROWSER_CANDIDATES", "/nonexistent/a:/nonexistent/b"); // test seam: empty candidate set
    const s = await loadedSession();
    await expect(rasterizeSlide(s, 0)).rejects.toMatchObject({ code: "browser-not-found" });
  });
});

describe.skipIf(!REAL_BROWSER)("MCP tool get_slide_image (end to end over the protocol)", () => {
  it("returns image content; guards surface as modeled errors", { timeout: 90_000, retry: 2 }, async () => {
    browserEnv();
    const server = buildServer(createSession(null));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientT);

    await client.callTool({ name: "new_project", arguments: { templateBase64: Buffer.from(templateBytes).toString("base64"), markdown: CJK_MD } });
    const res = (await client.callTool({ name: "get_slide_image", arguments: { index: 0 } })) as {
      content: Array<{ type: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.type).toBe("image");
    expect(res.content[0]?.mimeType).toBe("image/png");
    const bytes = Buffer.from(res.content[0]!.data!, "base64");
    expect(pngInfo(bytes).isPng).toBe(true);

    // Out-of-range index → the modeled { ok:false, code } envelope, not a crash.
    const bad = (await client.callTool({ name: "get_slide_image", arguments: { index: 99 } })) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    expect(bad.isError).toBeFalsy();
    const parsed = JSON.parse(bad.content[0]!.text!) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("index-out-of-range");
  });
});
