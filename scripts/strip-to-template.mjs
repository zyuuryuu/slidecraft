// strip-to-template.mjs — derive a "TemplateOnly" .pptx (master + layouts, ZERO slides) from a
// sample deck (…_全レイアウト見本.pptx). Removes the slide parts + their rels + notesSlides, empties
// <p:sldIdLst>, and drops the slide relationships / content-type overrides — matching the shape of
// Midnight_Executive_30_TemplateOnly.pptx (slides=0). Usage: node scripts/strip-to-template.mjs in.pptx out.pptx
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire("/home/zyuuryuu/Workspace/slidecraft/");
const JSZip = require("jszip");

async function stripToTemplate(inPath, outPath) {
  const zip = await JSZip.loadAsync(readFileSync(inPath));
  for (const name of Object.keys(zip.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) zip.remove(name);
    else if (/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name)) zip.remove(name);
    else if (/^ppt\/notesSlides\//.test(name)) zip.remove(name);
  }
  // presentation.xml: empty the slide-id list (0 slides).
  let pres = await zip.file("ppt/presentation.xml").async("string");
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, "<p:sldIdLst/>");
  zip.file("ppt/presentation.xml", pres);
  // presentation rels: drop the per-slide relationships (Type ends with /slide), keep slideMaster/theme/notesMaster.
  let rels = await zip.file("ppt/_rels/presentation.xml.rels").async("string");
  rels = rels.replace(/<Relationship\b[^>]*Type="[^"]*\/slide"[^>]*\/>/g, "");
  zip.file("ppt/_rels/presentation.xml.rels", rels);
  // [Content_Types].xml: drop the slide + notesSlide overrides.
  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = ct.replace(/<Override\b[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "");
  ct = ct.replace(/<Override\b[^>]*PartName="\/ppt\/notesSlides\/[^"]*"[^>]*\/>/g, "");
  zip.file("[Content_Types].xml", ct);
  writeFileSync(outPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  console.log(`stripped ${inPath} → ${outPath}`);
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error("usage: node strip-to-template.mjs in.pptx out.pptx"); process.exit(1); }
await stripToTemplate(inPath, outPath);
