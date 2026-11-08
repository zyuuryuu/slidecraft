/**
 * kpi-desc-bullet-645.test.ts — #645: KPI タイルの説明行（値以外の body 枠）にも箇条記号「•」が描かれる。
 *
 * #638（PR #644）で値枠は buNone になったが、説明行は kpi グループの body 枠へ `bullet: true` のまま束縛され、
 * マスター lvl1 の記号を継いでいた。kpi グループの body 枠へ束縛する段落も箇条を外す（判定は group-layout の
 * role だけ・R8）。説明行そのものの出力は tests/kpi-value-bullet-638.test.ts が固定する。ここでは
 *  - kpi の body 枠の段落が bullet を持たないこと（expandGroups の層）
 *  - 裁定 A（PR #656）: 説明枠の無い KPI.2／KPI.3Value（値枠＋ラベル枠）と KPI.4Value.Grid（ラベル枠のみ）で
 *    ラベル枠へ流れる見出しでない段落（説明行・KPI.4 では値も）も buNone。ラベル（`###`）と値枠は従来どおり
 *  - card / step / compare の body 段落は箇条のまま（expandGroups の層）
 *  - kpi 以外のスライドの slide XML が修正前と byte-identical（digest＝XML の sha256 を修正前の main で固定）
 * を確かめる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { expandGroups, detectGroups } from "../src/engine/group-binding";
import { writePresetTemplate, REPORT_PRESET } from "../src/engine/template-presets";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import type { GroupLayoutShape } from "../src/engine/group-layout";

const REPORT = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");

const COVER = "# 表紙\n\nサブ\n\n---\n\n";
const KPI1 = COVER + "# 削減効果\n\n<!-- kpi -->\n### 年間コスト削減\n- **4.2 億円**\n- 平年度ベース\n- 補足";
const BODY = (kind: string) =>
  COVER + `# ${kind}\n\n<!-- ${kind} -->\n### A\n- a1\n- a2\n\n<!-- ${kind} -->\n### B\n- b1\n\n<!-- ${kind} -->\n### C\n- c1`;

/** 表紙・箇条・card・step・compare（kpi を含まない）。最後に kpi を 1 枚置き、それ以外の slide XML を digest する。 */
const MIXED =
  "# 表紙\n\nサブ\n\n---\n\n# 箇条\n\n- 一\n  - 二\n- 三\n\n---\n\n" +
  ["card", "step", "compare"].map((k) => BODY(k).slice(COVER.length)).join("\n\n---\n\n") +
  "\n\n---\n\n# 削減効果\n\n<!-- kpi -->\n### 年間コスト削減\n- **4.2 億円**\n- 平年度ベース";

const tpls: Record<string, TemplateData> = {};
beforeAll(async () => {
  tpls.writerDefault = await loadTemplate(
    await writeTemplate({ name: "G", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } }),
  );
  tpls.reportPreset = await loadTemplate(await writePresetTemplate(REPORT_PRESET));
  tpls.report = await loadTemplate(readFileSync(REPORT));
});

describe("#645 kpi グループの body 枠の段落は箇条を外す（expandGroups）", () => {
  // 対象は kpi グループの body 枠（と値枠）へ束縛された段落。ラベル枠へ流れる説明行は下の「裁定 A」が固定する。
  it("kpi グループの body／value 枠へ束縛された段落はすべて bullet を持たない", () => {
    const deck = parseMd(KPI1);
    const slide = deck.slides[deck.slides.length - 1];
    const covered = new Set<string>();
    for (const tpl of Object.values(tpls)) {
      for (const layout of tpl.layouts) {
        const shape = detectGroups(layout);
        if (shape?.kind !== "kpi") continue;
        const bound = expandGroups(slide, layout);
        for (const slot of shape.groups.flat().filter((s) => s.role === "body" || s.role === "value")) {
          for (const p of bound.get(slot.phIdx)?.paragraphs ?? []) {
            const text = p.segments.map((s) => s.text).join("");
            expect(!p.bullet && p.level === undefined && p.ordered === undefined, `${layout.name} ${slot.phIdx} ${text}`).toBe(true);
            covered.add(text);
          }
        }
      }
    }
    // 説明行（値の後の行）が body 枠で確かめられたこと。
    expect([...covered]).toEqual(expect.arrayContaining(["4.2 億円", "平年度ベース", "補足"]));
  });
});

describe("#645 kpi 以外のグループの body 段落は箇条のまま", () => {
  for (const kind of ["card", "step", "compare"] as GroupLayoutShape["kind"][]) {
    it(`${kind}: body 段落は bullet: true を保つ`, () => {
      const deck = parseMd(BODY(kind));
      const slide = deck.slides[deck.slides.length - 1];
      let checked = 0;
      for (const tpl of Object.values(tpls)) {
        for (const layout of tpl.layouts) {
          if (detectGroups(layout)?.kind !== kind || expandGroups(slide, layout).size === 0) continue;
          const bodies = [...expandGroups(slide, layout).values()]
            .flatMap((c) => c.paragraphs)
            .filter((p) => /^[abc]\d$/.test(p.segments[0]?.text ?? ""));
          if (bodies.length === 0) continue;
          checked++;
          expect(bodies.every((p) => p.bullet === true), layout.name).toBe(true);
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

const BU_NONE = "<a:pPr><a:buNone/></a:pPr>";
const para = (t: string, rPr = "") => `<a:p>${BU_NONE}<a:r>${rPr}<a:t>${t}</a:t></a:r></a:p>`;
const KPI_N = (n: number) =>
  COVER + "# K\n\n" + Array.from({ length: n }, (_, i) => `<!-- kpi -->\n### ラベル${i + 1}\n- **値${i + 1}**\n- 説明${i + 1}`).join("\n\n");

/** Paragraphs of every shape on the LAST slide, keyed by shape name, plus that slide's layout part. */
async function lastSlide(md: string, tpl: TemplateData): Promise<{ layout: string; at: Map<string, string[]> }> {
  const deck = parseMd(md);
  const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
  const n = deck.slides.length;
  const xml = await zip.file(`ppt/slides/slide${n}.xml`)!.async("string");
  const rels = await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)!.async("string");
  const layoutPart = /slideLayouts\/(slideLayout\d+\.xml)/.exec(rels)![1];
  const layoutXml = await zip.file(`ppt/slideLayouts/${layoutPart}`)!.async("string");
  const at = new Map<string, string[]>();
  for (const sp of xml.split("<p:sp>").slice(1)) {
    const name = /<p:cNvPr id="\d+" name="([^"]*)"/.exec(sp)?.[1];
    if (name) at.set(name, sp.match(/<a:p>.*?<\/a:p>/g) ?? []);
  }
  return { layout: /<p:cSld name="([^"]*)"/.exec(layoutXml)![1], at };
}

// 裁定 A（PR #656）: kpi グループの見出しでない段落は、どの枠に入っても箇条を外す（判定は kind だけ・R8）。
describe("#645 裁定 A: ラベル枠へ流れる kpi の説明行も buNone", () => {
  for (const key of ["writerDefault", "reportPreset"]) {
    it(`KPI.2Value.Equal（${key}）: ラベル枠の説明行が buNone・値とラベルは従来どおり`, async () => {
      const { layout, at } = await lastSlide(KPI_N(2), tpls[key]);
      expect(layout).toBe("KPI.2Value.Equal");
      expect(at.get("Value1.Left")).toEqual([para("値1", '<a:rPr b="1"/>')]);
      expect(at.get("ValueLabel1.Left")).toEqual([para("ラベル1"), para("説明1")]);
      expect(at.get("ValueLabel2.Right")).toEqual([para("ラベル2"), para("説明2")]);
    });
    it(`KPI.3Value.Equal（${key}）: ラベル枠の説明行が buNone`, async () => {
      const { layout, at } = await lastSlide(KPI_N(3), tpls[key]);
      expect(layout).toBe("KPI.3Value.Equal");
      expect(at.get("Value3")).toEqual([para("値3", '<a:rPr b="1"/>')]);
      for (const i of [1, 2, 3]) expect(at.get(`Label${i}`)).toEqual([para(`ラベル${i}`), para(`説明${i}`)]);
    });
    it(`KPI.4Value.Grid（${key}）: ラベル枠 1 つに入る値・説明行が buNone`, async () => {
      const { layout, at } = await lastSlide(KPI_N(4), tpls[key]);
      expect(layout).toBe("KPI.4Value.Grid");
      for (const [i, name] of ["Value1.TL", "Value2.TR", "Value3.BL", "Value4.BR"].entries()) {
        const k = i + 1;
        expect(at.get(name)).toEqual([para(`ラベル${k}`), para(`値${k}`, '<a:rPr b="1"/>'), para(`説明${k}`)]);
      }
    });
  }
});

/**
 * 修正前（main 2ac4525）の出力で固定した、kpi 以外のスライドの slide XML の sha256。
 * 再固定の手順: kpi 以外の出力を意図して変える PR でだけ、その PR の親（main）で下の describe を走らせ、
 * 失敗メッセージの Received（新しい sha256）を写す。修正後のブランチの値を写してはならない（検査にならない）。
 */
const NON_KPI_DIGEST: Record<string, string> = {
  // writer と REPORT_PRESET は slide XML が同じ（配色・フォントは theme/master 側）なので digest も同じ。
  writerDefault: "1c070b9ff905d628cf2bf35ecebdb65756b1a8660a1369852b8c0e4e9aaac25a",
  reportPreset: "1c070b9ff905d628cf2bf35ecebdb65756b1a8660a1369852b8c0e4e9aaac25a",
  report: "b43e856f80e2c3728873a6774add7bb48f66e9acf02cddf216ffbfd018898c20",
};

describe("#645 kpi 以外のスライドの slide XML は byte-identical", () => {
  for (const key of ["writerDefault", "reportPreset", "report"]) {
    it(key, async () => {
      const deck = parseMd(MIXED);
      const zip = await JSZip.loadAsync(await generatePptx(deck, tpls[key]));
      const h = createHash("sha256");
      for (let i = 1; i < deck.slides.length; i++) {
        h.update(await zip.file(`ppt/slides/slide${i}.xml`)!.async("string"));
      }
      expect(h.digest("hex")).toBe(NON_KPI_DIGEST[key]);
    });
  }
});
