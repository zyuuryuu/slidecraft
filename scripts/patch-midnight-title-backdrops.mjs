// patch-midnight-title-backdrops.mjs — one-time, IDEMPOTENT fix for Issue #274.
//
// The bundled Midnight Executive template (public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx)
// shipped 19 layouts WITHOUT the dark backdrop behind their white title, so the title rendered
// white-on-white and was invisible (preview + export). The other 12 layouts already carry a dark backdrop
// (a `HeaderBar` / `BG` shape). This injects the SAME backdrop shape those working layouts use into each
// affected layout — matching its title geometry — without touching fonts, placeholders, or other layouts.
//
// Idempotent: skips any layout that already has a `TitleBackdrop` shape, so re-running is a no-op. The
// backdrop is inserted as the BACKMOST shape (first in <p:spTree>), so placeholders stay on top.
//
// Run:  node scripts/patch-midnight-title-backdrops.mjs
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx";
const EMU_W = 12192000; // 13.333in
const EMU_H = 6858000; //  7.5in
const BAR_H = 1051560; //  1.15in — same as the working Content.1Body.Single HeaderBar
const PANEL_W = 4206240; //  4.6in — left rail wide enough for the agenda title, clear of the right column

// TOP_BAR: title+subtitle sit at the very top → a full-width dark header bar (like Content.1Body.Single).
const TOP_BAR = new Set([
  "Column.2Body.MainSub", "Column.3Body.Equal",
  "KPI.1Value.Single", "KPI.2Value.Equal", "KPI.3Value.Equal", "KPI.4Value.Grid",
  "Chart.1Chart.Single", "Chart.1Chart.Single+1Analysis", "Chart.2Chart.Equal",
  "Table.1Table.Single+1Source", "Table.1Table.Single+1Notes",
  "Compare.2Option.Versus", "Compare.1Matrix.Single",
  "Process.4Step.Sequential", "Process.3Step.Sequential", "Summary.2Block.Equal",
]);
// FULL_DARK_BG: centered white title, no dark body text on the slide → a full-slide dark fill.
const FULL_DARK = new Set(["Closing.1Message.Single", "Closing.1Steps.Single+1Notes"]);
// LEFT_PANEL: left-column title with a LIGHT agenda (dark text) on the right → a dark left rail only.
const LEFT_PANEL = new Set(["Summary.1Agenda.Single"]);

const backdrop = (id, cx, cy) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TitleBackdrop"/>` +
  `<p:cNvSpPr><a:spLocks noGrp="1" noSelect="0" noRot="1" noMove="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill>` +
  `<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;

const zip = await JSZip.loadAsync(readFileSync(FILE));
const layoutPaths = Object.keys(zip.files).filter((p) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p));

let patched = 0;
for (const path of layoutPaths) {
  let xml = await zip.file(path).async("string");
  const name = xml.match(/<p:cSld[^>]*\bname="([^"]*)"/)?.[1] ?? "";
  let cx, cy;
  if (TOP_BAR.has(name)) { cx = EMU_W; cy = BAR_H; }
  else if (FULL_DARK.has(name)) { cx = EMU_W; cy = EMU_H; }
  else if (LEFT_PANEL.has(name)) { cx = PANEL_W; cy = EMU_H; }
  else continue;
  if (xml.includes('name="TitleBackdrop"')) { continue; } // already patched — idempotent
  const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => Number(m[1]));
  const id = (ids.length ? Math.max(...ids) : 1) + 1;
  const sp = backdrop(id, cx, cy);
  // Insert as the FIRST shape in the spTree (backmost), right after the group's <p:grpSpPr>.
  const next = xml.replace(/(<p:spTree>[\s\S]*?<\/p:grpSpPr>)/, `$1${sp}`);
  if (next === xml) throw new Error(`spTree/grpSpPr anchor not found in ${path}`);
  zip.file(path, next);
  patched++;
  console.log(`patched ${path} [${name}] cx=${cx} cy=${cy} id=${id}`);
}

const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync(FILE, out);
console.log(`Done. Patched ${patched} layout(s).`);
