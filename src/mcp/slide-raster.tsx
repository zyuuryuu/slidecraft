/**
 * slide-raster.tsx — #109: render ONE slide's CURRENT drawing to PNG for `get_slide_image`
 * (the upstream AI's visual design check), and #522: the WHOLE deck as one labeled contact sheet
 * for `get_deck_image` (the finishing check in one round trip — same page markup, same rasterizer,
 * shot once at a planned window size). 方式 A1, decided in #109 and not deviated from:
 *
 *  - The page IS the shared rendering: the SAME SlideCard the preview mounts and the HTML export
 *    SSRs (WYSIWYG single source — #105's drawing fixes apply here automatically), wrapped by
 *    html-shell's assembleSlidePage (zero <script>, CSP forbids script + all network).
 *  - Fonts: the bundled Noto variable fonts (the exact sources the HTML export subsets from,
 *    #115/#193/#194) are embedded UNSUBSETTED — the temp page never ships, so size is irrelevant
 *    and glyph shapes are identical to the export's subsets. Best-effort (do-no-harm): a missing
 *    font asset skips embedding and the CSS fallback stack takes over.
 *  - Browser: ONLY what the machine already has (env override → system Chrome/Edge). No auto
 *    download, no bundling — an app-pinned browser rots into a known-vulnerable one; browser
 *    security lifetime belongs to the OS/vendor auto-update (#109's security decision;
 *    ADR-0017's pinned-DL pattern explicitly does NOT extend to browsers). Absent → GuardError
 *    with guidance (never-silent) — screenshots are optional, the rest of the server still works.
 *  - Confinement: disposable profile, extensions/sync/first-run off, and the network is DEAD
 *    (all HTTP(S) forced through a closed local proxy port + DNS mapped to NOTFOUND — the proxy
 *    kills direct-IP fetches DNS rules can't). Chromium's sandbox stays ON by default;
 *    SLIDECRAFT_BROWSER_NO_SANDBOX=1 is an explicit opt-out for root-only containers.
 *
 * MCP layer (fs/child_process allowed; R2 engine purity untouched). Doc state comes from the
 * host's existing resolution — this module takes a Session and holds nothing (ADR-0033 D1).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard, SLIDE_W, SLIDE_H } from "../components/SlidePreview";
import { buildCatalog } from "../engine/template-catalog";
import { autoSelectLayout, findLayout, type TemplateData } from "../engine/template-loader";
import { materializeDerivedSlides, sectionFooterFor } from "../engine/deck-sections";
import { assembleSlidePage, assembleContactSheetPage, type EmbeddedFontFace } from "../engine/html-shell";
import { embedFallbackFamily, type CjkClass } from "../engine/font-stack";
import { cjkClassesForTemplate } from "../engine/cjk-class";
import { resolveFontSubsetSource } from "../engine/font-subset-plan";
import { collectDeckText, deckHasCjkText } from "../engine/deck-text-collect";
import type { DeckIR } from "../engine/slide-schema";
import { type Session, requireLoaded, assertIndex } from "./session";
import { GuardError } from "./guard-errors";

/** px-per-inch, same reference scale as the HTML export (deck-html-export). */
const SCALE = 96;
/** Screenshot viewport: the 13.33×7.5in slide at 96dpi, rounded up to whole pixels. */
export const RASTER_W = 1280;
export const RASTER_H = 720;

// ── Browser discovery: env override → system Chrome/Edge → null ──

const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];
const DARWIN_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
function winCandidates(env: NodeJS.ProcessEnv): string[] {
  const roots = [env["PROGRAMFILES"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]].filter((r): r is string => !!r);
  return roots.flatMap((r) => [join(r, "Google/Chrome/Application/chrome.exe"), join(r, "Microsoft/Edge/Application/msedge.exe")]);
}

/** システムにある Chromium 系ブラウザの探索。SLIDECRAFT_BROWSER（明示指定）が最優先 — 指定が
 *  実在しないときは fallthrough せず never-silent に落とす（黙って別のブラウザで撮らない）。
 *  SLIDECRAFT_BROWSER_CANDIDATES はテスト用シーム（`:` 区切りで候補列を差し替え）。 */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): { path: string; source: "env" | "system" } | null {
  const explicit = env["SLIDECRAFT_BROWSER"];
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new GuardError(`SLIDECRAFT_BROWSER に指定されたブラウザが見つかりません: ${explicit}`, "browser-not-found");
    }
    return { path: explicit, source: "env" };
  }
  const candidates = env["SLIDECRAFT_BROWSER_CANDIDATES"]
    ? env["SLIDECRAFT_BROWSER_CANDIDATES"].split(":")
    : process.platform === "darwin"
      ? DARWIN_CANDIDATES
      : process.platform === "win32"
        ? winCandidates(env)
        : LINUX_CANDIDATES;
  for (const c of candidates) if (c && existsSync(c)) return { path: c, source: "system" };
  return null;
}

// ── Single-slide page (shared rendering) ──

/** The bundled variable-font sources, read from disk (the Node sidecar has no fetch()-able asset
 *  server). SLIDECRAFT_FONT_DIR overrides; default is the repo/app `public/fonts`. Best-effort. */
function loadFontFace(cjkClass: CjkClass, env: NodeJS.ProcessEnv): EmbeddedFontFace | null {
  const { assetPath } = resolveFontSubsetSource(cjkClass, false);
  const dirs = [env["SLIDECRAFT_FONT_DIR"], join(process.cwd(), "public", "fonts")].filter((d): d is string => !!d);
  for (const dir of dirs) {
    const p = join(dir, basename(assetPath));
    try {
      const bytes = readFileSync(p);
      // Unsubsetted variable font as ONE face covering all weights (weightRange) — same glyphs the
      // export's subsets are cut from, so the raster can't diverge from the export typographically.
      return { family: embedFallbackFamily(cjkClass), weight: 400, weightRange: "100 900", ttfBase64: bytes.toString("base64") };
    } catch {
      // try the next candidate dir
    }
  }
  return null;
}

function embeddedFontsFor(deck: DeckIR, template: TemplateData, env: NodeJS.ProcessEnv): EmbeddedFontFace[] {
  if (!deckHasCjkText(collectDeckText(deck))) return [];
  // #573: the ONE resolve→classify entry (R8) — the same class the painter's font-family asks for.
  const classes = cjkClassesForTemplate(template);
  const faces: EmbeddedFontFace[] = [];
  for (const c of classes) {
    const f = loadFontFace(c, env);
    if (f) faces.push(f);
  }
  return faces;
}

/** The deck as the renderer sees it: derived slides materialized, catalog built — resolved ONCE per
 *  call so a whole-deck sheet doesn't redo it per slide. */
function preparedDeck(session: Session) {
  const { deck, template } = requireLoaded(session);
  const prepared = materializeDerivedSlides(deck);
  return { prepared, template, catalog: buildCatalog(template) };
}

/** SSR ONE slide's markup (SlideCard, exportMode, 96dpi) — THE single render path (R8): the
 *  single-slide page and the deck contact sheet both wrap exactly this string. */
function renderSlideBody(p: ReturnType<typeof preparedDeck>, index: number): string {
  const { prepared, template, catalog } = p;
  const slide = prepared.slides[index];
  const layout = findLayout(template, autoSelectLayout(slide, index, prepared.slides.length, catalog));
  return renderToStaticMarkup(
    <SlideCard
      slide={slide}
      slideIndex={index}
      totalSlides={prepared.slides.length}
      layout={layout}
      masterBgColor={template.masterBgColor}
      masterBackgroundImage={template.masterBackgroundImage}
      masterBackgroundGradient={template.masterBackgroundGradient}
      masterDecorations={template.masterDecorations}
      masterImages={template.masterImages}
      masterStaticTexts={template.masterStaticTexts}
      themeColors={template.themeColors}
      themeFonts={template.themeFonts}
      scale={SCALE}
      sectionFooterText={sectionFooterFor(prepared, index)}
      exportMode
    />,
  );
}

/** SSR ONE slide to a self-contained, script-free page — the SAME SlideCard + layout resolution +
 *  derived-slide materialization as the preview and the HTML export (WYSIWYG single source). */
export function renderSlideHtml(session: Session, index: number, env: NodeJS.ProcessEnv = process.env): string {
  const p = preparedDeck(session);
  assertIndex(p.prepared, index);
  return assembleSlidePage(renderSlideBody(p, index), {
    stageW: SLIDE_W * SCALE,
    stageH: SLIDE_H * SCALE,
    embeddedFonts: embeddedFontsFor(p.prepared, p.template, env),
  });
}

// ── Deck contact sheet (#522): every slide as a labeled thumbnail on ONE page, shot ONCE ──

/** Sizing defaults, measured in PR #522's body (30 mixed slides on the Midnight fixture → a
 *  1918×1436 PNG of ≈180 KB, rasterized in <1 s; far under the Issue's 2–3 MB ceiling):
 *  - columns 5 / maxSlides 30: one default call covers a typical deck in a single round trip;
 *  - maxWidth 1920: cells of 374 px — layout, overflow and figure shrink are visible, text is not
 *    meant to be read here (that is get_slide_image's job);
 *  - pixelBudget 3.2 Mpx (≈1920×1660): a tall request (few columns × many slides) shrinks the sheet
 *    instead of producing a multi-thousand-px image (columns:2 × 30 slides → 1244×2558 would be
 *    ~3.2 Mpx anyway; columns:1 is clamped the same way). */
export const DECK_SHEET = { columns: 5, maxSlides: 30, maxWidth: 1920, pixelBudget: 3_200_000, labelH: 20, gap: 8, pad: 8 } as const;

export interface DeckSheetOptions {
  /** First slide (0-based, default 0). Out of range → index-out-of-range. */
  start?: number;
  /** Grid columns (default DECK_SHEET.columns; clamped to the slide count so a short deck gets bigger cells). */
  columns?: number;
  /** Max slides on this sheet (default DECK_SHEET.maxSlides). Slides left after the window → truncated:true. */
  maxSlides?: number;
}

export interface DeckSheetPlan {
  from: number;
  count: number;
  total: number;
  truncated: boolean;
  columns: number;
  rows: number;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
}

/** Pure geometry: window the deck (start/maxSlides), pick whole-pixel cells that fill `maxWidth`, then
 *  shrink until the sheet fits `pixelBudget`. The browser window is set to exactly width×height. */
export function planDeckSheet(total: number, o: DeckSheetOptions): DeckSheetPlan {
  const from = o.start ?? 0;
  if (!Number.isInteger(from) || from < 0 || from >= total) {
    throw new GuardError(`スライド番号が範囲外です（0..${total - 1}）: ${from}`, "index-out-of-range");
  }
  const maxSlides = o.maxSlides ?? DECK_SHEET.maxSlides;
  if (!Number.isInteger(maxSlides) || maxSlides < 1) throw new GuardError(`maxSlides は 1 以上の整数で指定してください: ${maxSlides}`, "invalid-argument");
  const wantCols = o.columns ?? DECK_SHEET.columns;
  if (!Number.isInteger(wantCols) || wantCols < 1) throw new GuardError(`columns は 1 以上の整数で指定してください: ${wantCols}`, "invalid-argument");
  const count = Math.min(maxSlides, total - from);
  const columns = Math.min(wantCols, count);
  const rows = Math.ceil(count / columns);
  const { labelH, gap, pad } = DECK_SHEET;
  const geometry = (cellW: number) => {
    const cellH = Math.round((cellW * SLIDE_H) / SLIDE_W);
    return { cellW, cellH, width: 2 * pad + columns * cellW + (columns - 1) * gap, height: 2 * pad + rows * (labelH + cellH) + (rows - 1) * gap };
  };
  let g = geometry(Math.floor((DECK_SHEET.maxWidth - 2 * pad - (columns - 1) * gap) / columns));
  if (g.width * g.height > DECK_SHEET.pixelBudget) g = geometry(Math.floor(g.cellW * Math.sqrt(DECK_SHEET.pixelBudget / (g.width * g.height))));
  while (g.width * g.height > DECK_SHEET.pixelBudget && g.cellW > 16) g = geometry(g.cellW - 1); // fixed pad/gap make the sqrt step approximate
  // truncated = slides remain AFTER this window (the caller pages on with start = from + count).
  return { from, count, total, truncated: from + count < total, columns, rows, ...g };
}

/** ONE self-contained page with slides [from, from+count) as labeled thumbnails — each cell wraps the
 *  byte-identical markup renderSlideHtml puts in its <body> (R8: no second render path). */
export function renderDeckHtml(session: Session, o: DeckSheetOptions, env: NodeJS.ProcessEnv = process.env): { html: string; meta: DeckSheetPlan } {
  const p = preparedDeck(session);
  const meta = planDeckSheet(p.prepared.slides.length, o);
  const cells = Array.from({ length: meta.count }, (_, k) => ({ index: meta.from + k, slideHtml: renderSlideBody(p, meta.from + k) }));
  const html = assembleContactSheetPage(cells, {
    stageW: SLIDE_W * SCALE,
    stageH: SLIDE_H * SCALE,
    columns: meta.columns,
    cellW: meta.cellW,
    cellH: meta.cellH,
    labelH: DECK_SHEET.labelH,
    gap: DECK_SHEET.gap,
    pad: DECK_SHEET.pad,
    width: meta.width,
    height: meta.height,
    embeddedFonts: embeddedFontsFor(p.prepared, p.template, env),
  });
  return { html, meta };
}

// ── Headless rasterization (confined) ──

/** Screenshot `html` in the given Chromium-family browser. Network is DEAD (closed-port proxy +
 *  NOTFOUND DNS), profile is disposable, sandbox stays on unless explicitly opted out (root
 *  containers). Returns the PNG bytes; any failure is a modeled, never-silent GuardError.
 *  `width`/`height` size the window (default: one slide); the deck sheet passes its own plan. */
export async function rasterizeHtml(
  browserPath: string,
  html: string,
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; width?: number; height?: number } = {},
): Promise<Buffer> {
  const env = opts.env ?? process.env;
  const work = mkdtempSync(join(tmpdir(), "slidecraft-raster-"));
  const pagePath = join(work, "slide.html");
  const pngPath = join(work, "slide.png");
  writeFileSync(pagePath, html, "utf8");
  const args = [
    "--headless",
    `--screenshot=${pngPath}`,
    `--window-size=${opts.width ?? RASTER_W},${opts.height ?? RASTER_H}`,
    "--hide-scrollbars",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${join(work, "profile")}`,
    // Network kill-switch: every HTTP(S)/WS request is forced through a proxy on a closed local
    // port (covers direct-IP URLs), and DNS resolves nothing (belt & suspenders). file:// and
    // data: — all the page needs — bypass proxies by definition.
    "--proxy-server=http://127.0.0.1:9",
    "--host-resolver-rules=MAP * ~NOTFOUND",
    // Deterministic settle for the data:-URI fonts/images before the shot, and force every
    // compositor stage so the screenshot can never capture a partially painted frame (CI's
    // chrome produced a text-less shot without it).
    "--virtual-time-budget=10000",
    "--run-all-compositor-stages-before-draw",
    ...(env["SLIDECRAFT_BROWSER_NO_SANDBOX"] === "1" ? ["--no-sandbox"] : []),
    pathToFileURL(pagePath).href,
  ];
  try {
    const stderr = await new Promise<string>((resolve, reject) => {
      const child = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new GuardError(`ブラウザの描画がタイムアウトしました（${opts.timeoutMs ?? 30000}ms）: ${browserPath}`, "raster-timeout"));
      }, opts.timeoutMs ?? 30000);
      child.stderr.on("data", (d: Buffer) => (err += d.toString()));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new GuardError(`ブラウザを起動できませんでした: ${browserPath}（${e.message}）`, "browser-launch-failed"));
      });
      child.on("exit", () => {
        clearTimeout(timer);
        resolve(err);
      });
    });
    if (!existsSync(pngPath)) {
      const tail = stderr.split("\n").filter(Boolean).slice(-3).join(" / ");
      throw new GuardError(`スクリーンショットを生成できませんでした（${browserPath}）。${tail ? `ブラウザ出力: ${tail}` : ""}`, "raster-failed");
    }
    return readFileSync(pngPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export interface SlideImage {
  pngBase64: string;
  mimeType: "image/png";
  width: number;
  height: number;
  browserPath: string;
}

/** Browser absence is a modeled, GUIDING error (screenshots are optional; the server keeps working
 *  without them) — ONE wording for get_slide_image and get_deck_image. */
function requireBrowser(env: NodeJS.ProcessEnv): string {
  const found = findBrowser(env);
  if (!found) {
    throw new GuardError(
      "スクリーンショット用の Chromium 系ブラウザが見つかりません。Google Chrome / Microsoft Edge をインストールするか、環境変数 SLIDECRAFT_BROWSER に実行ファイルのパスを指定してください（このツールは任意機能です — 他のツールはブラウザなしで動作します）。",
      "browser-not-found",
    );
  }
  return found.path;
}

/** The full get_slide_image path: resolve doc state → shared-rendering page → confined headless
 *  screenshot. */
export async function rasterizeSlide(session: Session, index: number, env: NodeJS.ProcessEnv = process.env): Promise<SlideImage> {
  const browserPath = requireBrowser(env);
  const html = renderSlideHtml(session, index, env);
  const png = await rasterizeHtml(browserPath, html, { env });
  return { pngBase64: png.toString("base64"), mimeType: "image/png", width: RASTER_W, height: RASTER_H, browserPath };
}

export type DeckImage = SlideImage & DeckSheetPlan;

/** The full get_deck_image path (#522): the contact-sheet page, shot ONCE at exactly the planned
 *  width×height by the same confined rasterizer as get_slide_image. */
export async function rasterizeDeck(session: Session, o: DeckSheetOptions, env: NodeJS.ProcessEnv = process.env): Promise<DeckImage> {
  const browserPath = requireBrowser(env);
  const { html, meta } = renderDeckHtml(session, o, env);
  // Same 30 s deadline as one slide (measured <1 s for 30 slides) — a longer one would outlive the
  // MCP SDK's default 60 s client timeout and turn a modeled raster-timeout into a transport error.
  const png = await rasterizeHtml(browserPath, html, { env, width: meta.width, height: meta.height });
  return { pngBase64: png.toString("base64"), mimeType: "image/png", browserPath, ...meta };
}
