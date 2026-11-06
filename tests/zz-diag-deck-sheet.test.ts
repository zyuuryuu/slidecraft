/**
 * TEMPORARY DIAGNOSTIC (PR #528 — to be reverted): CI's /usr/bin/google-chrome produces a ~4.8 KB
 * contact-sheet PNG (sheet content not painted) while the single-slide page paints fine and the
 * same sheet paints in Playwright-driven Chromium / chrome-headless-shell. This file shoots the
 * sheet under a matrix of variants in ONE CI round and dumps every PNG + the HTML to diag-out/
 * (uploaded as an artifact). Runs only with SLIDECRAFT_DIAG=1.
 */
import { it } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSession, newProject } from "../src/mcp/session";
import { renderDeckHtml, renderSlideHtml, findBrowser } from "../src/mcp/slide-raster";

const OUT = resolve(process.cwd(), "diag-out");
const TEMPLATE = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const MD3 = "# 四半期経営レビュー\n> 経営企画部\n\n---\n\n# 現状分析\n\n- 売上高は前年比120%で推移\n- 新規顧客が32社増加\n\n---\n\n# 来期の重点施策\n\n- 既存顧客の深耕\n- 新チャネル開拓";

const BASE_FLAGS = [
  "--hide-scrollbars", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--disable-sync",
  "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
  "--proxy-server=http://127.0.0.1:9", "--host-resolver-rules=MAP * ~NOTFOUND",
];
const SETTLE = ["--virtual-time-budget=10000", "--run-all-compositor-stages-before-draw"];

async function shoot(browser: string, name: string, html: string, w: number, h: number, extra: string[]): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "diag-"));
  const page = join(work, "p.html");
  const png = join(work, "p.png");
  writeFileSync(page, html);
  const args = ["--headless", `--screenshot=${png}`, `--window-size=${w},${h}`, ...BASE_FLAGS, ...extra, `--user-data-dir=${join(work, "prof")}`,
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), pathToFileURL(page).href];
  const t0 = Date.now();
  const stderr = await new Promise<string>((res) => {
    const c = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    c.stderr.on("data", (d: Buffer) => (e += d.toString()));
    const timer = setTimeout(() => c.kill("SIGKILL"), 60_000);
    c.on("exit", () => { clearTimeout(timer); res(e); });
  });
  const bytes = existsSync(png) ? readFileSync(png) : null;
  if (bytes) writeFileSync(join(OUT, `${name}.png`), bytes);
  writeFileSync(join(OUT, `${name}.stderr.txt`), stderr);
  console.log(`DIAG ${name}: ${bytes ? bytes.length : "NO-PNG"} bytes, ${Date.now() - t0} ms`);
  rmSync(work, { recursive: true, force: true });
}

it.skipIf(process.env.SLIDECRAFT_DIAG !== "1")("diag matrix", { timeout: 600_000 }, async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = findBrowser()!.path;
  const ver = await new Promise<string>((res) => { const c = spawn(browser, ["--version"]); let o = ""; c.stdout.on("data", (d: Buffer) => (o += d)); c.on("exit", () => res(o)); });
  console.log("DIAG browser", browser, ver.trim());
  const s = createSession(null);
  await newProject(s, new Uint8Array(readFileSync(TEMPLATE)), MD3);
  const { html, meta } = renderDeckHtml(s, {});
  const slide = renderSlideHtml(s, 0);
  writeFileSync(join(OUT, "deck.html"), html);
  writeFileSync(join(OUT, "plan.json"), JSON.stringify(meta));
  const { width: W, height: H } = meta;
  const stripFonts = (h: string) => h.replace(/@font-face\{[^}]*\}/g, "");
  const useZoom = (h: string) => h.replace(/transform:scale\(([\d.]+)\);transform-origin:0 0/, "zoom:$1");
  const noScale = (h: string) => h.replace(/transform:scale\(([\d.]+)\);transform-origin:0 0/, "");
  const willChange = (h: string) => h.replace(/transform-origin:0 0\}/, "transform-origin:0 0;will-change:transform}");
  const isolate = (h: string) => h.replace(/\.thumb\{/, ".thumb{position:relative;isolation:isolate;contain:paint;");
  const singleAtSheetSize = slide;
  const matrix: Array<[string, string, number, number, string[]]> = [
    ["01-baseline", html, W, H, SETTLE],
    ["02-no-vtb", html, W, H, ["--run-all-compositor-stages-before-draw"]],
    ["03-no-racsbd", html, W, H, ["--virtual-time-budget=10000"]],
    ["04-no-settle", html, W, H, []],
    ["05-no-fonts", stripFonts(html), W, H, SETTLE],
    ["06-zoom", useZoom(html), W, H, SETTLE],
    ["07-no-scale", noScale(html), W, H, SETTLE],
    ["08-will-change", willChange(html), W, H, SETTLE],
    ["09-isolate", isolate(html), W, H, SETTLE],
    ["10-sheet-1280x720", html, 1280, 720, SETTLE],
    ["11-single-at-sheet-size", singleAtSheetSize, W, H, SETTLE],
    ["12-single-baseline", slide, 1280, 720, SETTLE],
    ["13-no-fonts-no-vtb", stripFonts(html), W, H, ["--run-all-compositor-stages-before-draw"]],
    ["14-sheet-1920x1080", html, 1920, 1080, SETTLE],
    ["15-zoom-no-vtb", useZoom(html), W, H, ["--run-all-compositor-stages-before-draw"]],
  ];
  for (const [name, h, w, hh, extra] of matrix) await shoot(browser, name, h, w, hh, extra);
  const sizes = matrix.map(([name]) => `${name}: ${existsSync(join(OUT, `${name}.png`)) ? readFileSync(join(OUT, `${name}.png`)).length : "NO-PNG"}`).join("\n");
  writeFileSync(join(OUT, "sizes.txt"), `${ver.trim()}\n${sizes}\n`);
  process.stderr.write(`\nDIAG SIZES\n${ver.trim()}\n${sizes}\n`);
});
