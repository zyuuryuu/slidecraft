/**
 * slide-raster.tsx — #109: render ONE slide's CURRENT drawing to PNG for `get_slide_image`
 * (the upstream AI's visual design check). 方式 A1, decided in #109 and not deviated from:
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
import { assembleSlidePage, type EmbeddedFontFace } from "../engine/html-shell";
import { classifyCjkFont, embedFallbackFamily, type CjkClass } from "../engine/font-stack";
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
  const classes = new Set<CjkClass>([
    classifyCjkFont(template.masterTitleStyle.eaFontName ?? template.masterTitleStyle.fontName),
    classifyCjkFont(template.masterBodyStyle.eaFontName ?? template.masterBodyStyle.fontName),
  ]);
  const faces: EmbeddedFontFace[] = [];
  for (const c of classes) {
    const f = loadFontFace(c, env);
    if (f) faces.push(f);
  }
  return faces;
}

/** SSR ONE slide to a self-contained, script-free page — the SAME SlideCard + layout resolution +
 *  derived-slide materialization as the preview and the HTML export (WYSIWYG single source). */
export function renderSlideHtml(session: Session, index: number, env: NodeJS.ProcessEnv = process.env): string {
  const { deck, template } = requireLoaded(session);
  const prepared = materializeDerivedSlides(deck);
  assertIndex(prepared, index);
  const catalog = buildCatalog(template);
  const slide = prepared.slides[index];
  const layout = findLayout(template, autoSelectLayout(slide, index, prepared.slides.length, catalog));
  const slideHtml = renderToStaticMarkup(
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
      scale={SCALE}
      sectionFooterText={sectionFooterFor(prepared, index)}
      exportMode
    />,
  );
  return assembleSlidePage(slideHtml, {
    stageW: SLIDE_W * SCALE,
    stageH: SLIDE_H * SCALE,
    embeddedFonts: embeddedFontsFor(prepared, template, env),
  });
}

// ── Headless rasterization (confined) ──

/** Screenshot `html` in the given Chromium-family browser. Network is DEAD (closed-port proxy +
 *  NOTFOUND DNS), profile is disposable, sandbox stays on unless explicitly opted out (root
 *  containers). Returns the PNG bytes; any failure is a modeled, never-silent GuardError. */
export async function rasterizeHtml(
  browserPath: string,
  html: string,
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<Buffer> {
  const env = opts.env ?? process.env;
  const work = mkdtempSync(join(tmpdir(), "slidecraft-raster-"));
  const pagePath = join(work, "slide.html");
  const pngPath = join(work, "slide.png");
  writeFileSync(pagePath, html, "utf8");
  const args = [
    "--headless",
    `--screenshot=${pngPath}`,
    `--window-size=${RASTER_W},${RASTER_H}`,
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
    // Deterministic settle for the data:-URI fonts/images before the shot.
    "--virtual-time-budget=4000",
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

/** The full get_slide_image path: resolve doc state → shared-rendering page → confined headless
 *  screenshot. Browser absence is a modeled, GUIDING error (screenshots are optional; the server
 *  keeps working without them). */
export async function rasterizeSlide(session: Session, index: number, env: NodeJS.ProcessEnv = process.env): Promise<SlideImage> {
  const found = findBrowser(env);
  if (!found) {
    throw new GuardError(
      "スクリーンショット用の Chromium 系ブラウザが見つかりません。Google Chrome / Microsoft Edge をインストールするか、環境変数 SLIDECRAFT_BROWSER に実行ファイルのパスを指定してください（このツールは任意機能です — 他のツールはブラウザなしで動作します）。",
      "browser-not-found",
    );
  }
  const html = renderSlideHtml(session, index, env);
  const png = await rasterizeHtml(found.path, html, { env });
  return { pngBase64: png.toString("base64"), mimeType: "image/png", width: RASTER_W, height: RASTER_H, browserPath: found.path };
}
