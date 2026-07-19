/**
 * add-body-bullet-style.ts — one-off: bake buChar "•" + spcBef into the bundled Midnight template's
 * master bodyStyle lvl1 (#102 follow-through on #137/PR #180). #137 added this same bullet style to
 * NEWLY-GENERATED templates (template-writer.ts masterStyleXml), but the committed
 * Midnight_Executive_30_TemplateOnly.pptx binary predates that change and still has bodyStyle
 * <a:buNone/> — so a `- item` bullet paragraph (bullet:true, no explicit pPr) renders with no glyph in
 * either the SSR preview or the exported PPTX (both inherit the master's list style for bullet
 * paragraphs; a non-bullet paragraph always writes its own explicit <a:buNone/> at export time
 * regardless of the master — see md-to-ooxml.paragraphToOoxml — so titles/labels/values are
 * unaffected by this change).
 *
 * Title-type placeholders (ctrTitle/subTitle, only present on the Title/Closing layouts) keep
 * buNone via their OWN master text style (p:titleStyle, untouched here) — template-writer.ts
 * masterStyleXml is the reference for that split (#180).
 *
 * Unlike add-section-nav-list-layout.ts (which ADDS a new part), this PATCHES an existing part
 * in-place. Run once; the result is committed (both public/ and tests/fixtures/ copies, byte-identical).
 *
 * Usage: npx tsx scripts/add-body-bullet-style.ts
 */
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { BODY_BULLET_PPR } from "../src/engine/template-writer";

const OLD = "<p:bodyStyle><a:lvl1pPr algn=\"l\"><a:buNone/>";
const NEW = `<p:bodyStyle><a:lvl1pPr algn="l">${BODY_BULLET_PPR}`;

async function run() {
  const paths = [
    "public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx",
    "tests/fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx",
  ];

  for (const relPath of paths) {
    const path = resolve(relPath);
    const zip = await JSZip.loadAsync(readFileSync(path));

    let master = await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
    if (master.includes(BODY_BULLET_PPR)) {
      console.log(`  ${relPath}: bodyStyle already has the bullet style — skipping (idempotent)`);
      continue;
    }
    if (!master.includes(OLD)) {
      throw new Error(`${relPath}: expected bodyStyle shape not found — refusing to guess`);
    }
    master = master.replace(OLD, NEW);
    zip.file("ppt/slideMasters/slideMaster1.xml", master);

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    writeFileSync(path, buf);
    console.log(`  ${relPath}: bodyStyle lvl1 now has buChar "•" + spcBef`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
