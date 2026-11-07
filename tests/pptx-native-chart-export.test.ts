/**
 * pptx-native-chart-export.test.ts — #554 段 1: `generatePptx(..., { charts })` のデッキ書き出し。
 *
 * - 既定（オプション無し）と `charts: "shapes"` は **byte-identical**: chart 入りデッキの slide XML /
 *   slide rels / [Content_Types] の sha256 を実装前の main（a6dd400）で採った golden に固定。
 * - `charts: "native"`: pie / xychart / radar が `ppt/charts/chartN.xml`（`<c:chartSpace>`）＋埋め込み
 *   ワークブック（PowerPoint の「データの編集」の元）として出る。対象外の図（flowchart）は従来の図形の
 *   まま（その slide は golden と一致）。件数は report で native / shapes を返す（never-silent）。
 * - native の chart XML は golden（sha256）で固定。PptxGenJS の版上げ等で変わったら中身を見て更新する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { createHash } from "crypto";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { EMU_PER_INCH, nativeChartRect } from "../src/engine/pptx-native-chart";
import { parseDiagramYaml } from "../src/engine/diagram-node-shrink";
import { chartDeck, templateBytes } from "./native-chart-fixtures";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (zip: JSZip, f: string) => zip.file(f)!.async("string");

// Captured on main a6dd400 BEFORE #554 (the default path must not move by a byte).
const DEFAULT_GOLDEN: Record<string, string> = {
  "[Content_Types].xml": "dfacf6b5137abeab2d9fbb6a8de0f0a1f41f175e38850fa368c76c28d6af571a",
  "ppt/slides/_rels/slide1.xml.rels": "1ed261ceb1ed216d53f68afef2500f7fab7a1fee7038a260a567c2330ae926bb",
  "ppt/slides/_rels/slide2.xml.rels": "1ed261ceb1ed216d53f68afef2500f7fab7a1fee7038a260a567c2330ae926bb",
  "ppt/slides/_rels/slide3.xml.rels": "1ed261ceb1ed216d53f68afef2500f7fab7a1fee7038a260a567c2330ae926bb",
  "ppt/slides/_rels/slide4.xml.rels": "1ed261ceb1ed216d53f68afef2500f7fab7a1fee7038a260a567c2330ae926bb",
  "ppt/slides/slide1.xml": "be72714757a698df46ddcb753ab8a80d4258aea6100e9dbf5130aa31eeae0138",
  "ppt/slides/slide2.xml": "1e55df5d1e2842808547c0dbd402435f3948b4e0c1e6316c51d657b24ec6baa3",
  "ppt/slides/slide3.xml": "2dad49115fed6df271fc54d5da223adeeb855a56f134e743556477b0c176c255",
  "ppt/slides/slide4.xml": "178e6228cae455340cc662620666cd6223ddf26cdaf7df12b3addf86a920cbaf",
};

// native chart XML golden (pie / combo bar+line / radar) — pinned after a by-hand read of the XML and a
// LibreOffice render of the deck (2026-11-07); deterministic across runs. #566 re-pinned chart1 (pie data labels
// now value + %: showVal 1) and chart3 (radar <c:majorUnit val="1.5"/> = 4 rings, value labels tickLblPos none)
// after a re-read of the XML and a LibreOffice render; chart2 did not move.
const NATIVE_CHART_GOLDEN: Record<string, string> = {
  "ppt/charts/chart1.xml": "48e6edd67a2a22fd3549651ad8e7e0b8efa4731e9c222b31ba9b2c24e72e59a7",
  "ppt/charts/chart2.xml": "1006fc30f00d694691e1516ad56fb89473bea697cda5decad1cb3b2a9fb0e068",
  "ppt/charts/chart3.xml": "5788b1358836de9ac54c6dc9baeafcc10c78758229c8c658b50e5f90fc8cfd82",
};

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(templateBytes());
});

async function exportDeck(opts?: Parameters<typeof generatePptx>[3]) {
  return JSZip.loadAsync(await generatePptx(chartDeck(), tpl, undefined, opts));
}

describe("charts: default / \"shapes\" — byte-identical to pre-#554", () => {
  for (const opts of [undefined, { charts: "shapes" as const }]) {
    it(`${opts ? "explicit shapes" : "no option"}: slide XML / rels / content types == golden, no chart parts`, async () => {
      const zip = await exportDeck(opts);
      for (const [f, h] of Object.entries(DEFAULT_GOLDEN)) expect(sha(await text(zip, f)), f).toBe(h);
      expect(Object.keys(zip.files).filter((f) => /^ppt\/(charts|embeddings)\//.test(f))).toEqual([]);
    });
  }

  it("shapes mode reports every figure as shapes", async () => {
    const seen: string[] = [];
    await exportDeck({ charts: "shapes", onFigure: (k) => seen.push(k) });
    expect(seen).toEqual(["shapes", "shapes", "shapes", "shapes"]);
  });
});

describe("charts: \"native\" — pie / xychart / radar become native chart objects", () => {
  let zip: JSZip;
  const seen: string[] = [];
  beforeAll(async () => {
    zip = await exportDeck({ charts: "native", onFigure: (k) => seen.push(k) });
  });

  it("writes chart1..3.xml (<c:chartSpace>) of the right kinds + one embedded workbook each", async () => {
    const kinds = [["chart1", ["c:pieChart"]], ["chart2", ["c:barChart", "c:lineChart"]], ["chart3", ["c:radarChart"]]] as const;
    for (const [n, tags] of kinds) {
      const xml = await text(zip, `ppt/charts/${n}.xml`);
      expect(xml).toContain("<c:chartSpace");
      for (const t of tags) expect(xml, `${n} ${t}`).toContain(`<${t}>`);
      const rels = await text(zip, `ppt/charts/_rels/${n}.xml.rels`);
      const target = rels.match(/Target="\.\.\/embeddings\/([^"]+\.xlsx)"/)?.[1];
      expect(target, `${n} workbook rel`).toBeDefined();
      expect(zip.file(`ppt/embeddings/${target}`), `${n} workbook part`).not.toBeNull();
    }
    expect(zip.file("ppt/charts/chart4.xml")).toBeNull(); // the flowchart did NOT become a chart
  });

  it("the chart data carries the spec's labels and values (what 'データの編集' opens)", async () => {
    const pie = await text(zip, "ppt/charts/chart1.xml");
    for (const s of ["製品A", "製品B", "その他", "<c:v>42</c:v>", "<c:v>28</c:v>"]) expect(pie).toContain(s);
    expect(pie).not.toContain("ゼロ"); // value 0 slice is dropped — same as the shapes pie
    const xy = await text(zip, "ppt/charts/chart2.xml");
    for (const s of ["売上", "原価", "利益率", "Q4", "<c:v>210</c:v>"]) expect(xy).toContain(s);
    const radar = await text(zip, "ppt/charts/chart3.xml");
    for (const s of ["設計", "文書", "現状", "目標"]) expect(radar).toContain(s);
  });

  it("each chart slide references its chart via a graphicFrame + chart rel; content types declared", async () => {
    const ct = await text(zip, "[Content_Types].xml");
    expect(ct).toContain('<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>');
    for (const n of [1, 2, 3]) {
      const slide = await text(zip, `ppt/slides/slide${n}.xml`);
      const rels = await text(zip, `ppt/slides/_rels/slide${n}.xml.rels`);
      const rid = slide.match(/<c:chart r:id="([^"]+)"/)?.[1];
      expect(rid, `slide${n} graphicFrame`).toBeDefined();
      expect(rels).toContain(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${n}.xml"/>`);
      expect(ct).toContain(`<Override PartName="/ppt/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      // the chart replaced the figure's shapes: no <p:grpSp> figure group left on the slide
      expect(slide).not.toContain("<p:grpSp>");
      // shape ids stay unique on the slide (the frame was renumbered into the slide's id sequence)
      const ids = [...slide.matchAll(/<p:cNvPr\b[^>]*?\bid="(\d+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("the frame sits on the shapes figure's rectangle", async () => {
    const slide = await text(zip, "ppt/slides/slide2.xml");
    const m = slide.match(/<p:graphicFrame>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/)!;
    const yaml = chartDeck().slides[1].diagram!.yaml;
    const r = nativeChartRect(parseDiagramYaml(yaml)!)!;
    expect([+m[1], +m[2], +m[3], +m[4]]).toEqual([r.x, r.y, r.w, r.h].map((v) => Math.round(v * EMU_PER_INCH)));
  });

  it("non-chart figures fall back to shapes unchanged (slide4 == golden) and are counted", async () => {
    expect(sha(await text(zip, "ppt/slides/slide4.xml"))).toBe(DEFAULT_GOLDEN["ppt/slides/slide4.xml"]);
    expect(seen).toEqual(["native", "native", "native", "shapes"]);
  });

  it("native chart XML == golden", async () => {
    for (const [f, h] of Object.entries(NATIVE_CHART_GOLDEN)) expect(sha(await text(zip, f)), f).toBe(h);
  });
});
