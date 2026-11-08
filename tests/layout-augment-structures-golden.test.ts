/**
 * layout-augment-structures-golden.test.ts — #568 段 3 の golden（sha256 固定のスナップショット）。
 *
 * 比較・カード 3 枚・KPI ×3／×4 の合成レイアウト XML と、合成テンプレで書き出した組スライドの slide XML を
 * 固定する。値は 2026-11-08 に XML を目で読み（idx の組順・type="body" 明示・見出し lvl1 の sz/b/algn/buNone・
 * 本文 lvl1..4 の縮小・cNvPr id 重複なし）、LibreOffice 24.2 で描画（継承された帯・装飾・書体、KPI 中央揃え、
 * 数値が列内で折り返さない）を確かめてから採った。合成規則や書き出しを変えたら、中身を読み直してから更新する。
 *
 * fixture: Dirty_Grouped（素の名前・全 6 構造）・Dirty_Legacy43（KPI×4 が idx 17/18 を使う）・
 * Midnight（規約名マスター → Summary.3Block.Equal）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { augmentAndVerify } from "../src/engine/layout-augment";
import { ALL_AUGMENT_STRUCTURES } from "../src/engine/layout-augment-structures";
import { loadTemplate } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DIR = resolve(__dirname, "fixtures/templates");

const DECK_MD = [
  "# 表紙",
  "# 比較\n\n<!-- compare -->\n### A 案\n- 速い\n  - 高い\n\n<!-- compare -->\n### B 案\n- 安い",
  "# カード\n\n<!-- card -->\n### 収集\n- eBPF\n\n<!-- card -->\n### 分析\n- SIEM\n\n<!-- card -->\n### 運用\n- Sigma",
    // kpi: `### ラベル` + 最初の行が値（docs/guide/markdown-authoring.md）。#593 で値枠（大きな文字の枠）への束縛が
  // この規約どおりになったので、md もその向きに揃えた（旧版は値を見出しに書いていた）。
  "# KPI 3\n\n<!-- kpi -->\n### 稼働率\n- 98%\n\n<!-- kpi -->\n### 応答\n- 1.2 秒\n\n<!-- kpi -->\n### 障害\n- 30 件",
  "# KPI 4\n\n<!-- kpi -->\n### 拠点\n- 12\n\n<!-- kpi -->\n### 利用者\n- 3.4M\n\n<!-- kpi -->\n### SLA\n- 99.9%\n\n<!-- kpi -->\n### 製品\n- 5",
].join("\n\n---\n\n");

/** key: `layout:<structure>` = the synthesized slideLayout XML; `deck:<path>` = a part of the exported deck. */
const GOLDEN: Record<string, Record<string, string>> = {
  "Dirty_Grouped_TemplateOnly.pptx": {
    "layout:compare-2": "d66bc3341fe3cf801f9b922d3c6bee95eed466be8ff8fc9b09336d805a40dbc9",
    "layout:card-3": "d187da51de0ce398e0216546938e3374ebcc0008633d4a1a055572b6f6c33375",
    "layout:kpi-3": "3274f1e17dbeafaa8cdf2ea1737dc0ba1771768456451735173f06b734a8ceb1",
    "layout:kpi-4": "b25918054a58c8103b055d5b8906bd6322321785461adc142decac4c5127121d",
    "deck:ppt/slides/slide2.xml": "3b65229456d2597312cda798449ed884d3e8152b3e4729521da05e7b387bf2a9",
    "deck:ppt/slides/slide3.xml": "6934f904713969860a2856306289a7da5df9080add4f5ce876e8cc20166175a9",
    "deck:ppt/slides/slide4.xml": "3a06204175daf851435444f17a3494c7c865587fc0a34c5481182df9e828da1b",
    "deck:ppt/slides/slide5.xml": "6fc4532984d1562e841d16fe8e3fc48d0a4ddfbe9fec2099b37ff987107ec0ab",
  },
  "Dirty_Legacy43_TemplateOnly.pptx": {
    "layout:kpi-4": "2ea4bafab9e0320693d398d3e3289b0026701ed716ea1bf2d4193c6af24ea49a",
  },
  "Midnight_Executive_30_TemplateOnly.pptx": {
    "layout:card-3": "fdef7d111dec22a2865f9a25bb2dff379e89b2c7c8d6fbaf50039ede3d51b280",
    "deck:ppt/slides/slide3.xml": "254d31b68e8f0e2bf9d7a00b4dc0d28b41689c885db41c015084ef6188fdb3de",
  },
};

describe("layout augmentation golden — group structures (#568 段 3)", () => {
  for (const [file, golden] of Object.entries(GOLDEN)) {
    it(file, async () => {
      const r = await augmentAndVerify(readFileSync(resolve(DIR, file)), { structures: ALL_AUGMENT_STRUCTURES });
      expect(r.applied).toBe(true);
      const z = await JSZip.loadAsync(r.bytes);
      const deck = await JSZip.loadAsync(await generatePptx(parseMd(DECK_MD), await loadTemplate(r.bytes)));
      for (const [key, hash] of Object.entries(golden)) {
        let xml: string;
        if (key.startsWith("layout:")) {
          const a = r.added.find((x) => x.structure === key.slice(7));
          expect(a, key).toBeDefined();
          xml = await z.file(a!.part)!.async("string");
        } else xml = await deck.file(key.slice(5))!.async("string");
        expect(sha(xml), key).toBe(hash);
      }
    });
  }
});
