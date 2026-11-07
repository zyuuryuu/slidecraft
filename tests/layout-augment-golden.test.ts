/**
 * layout-augment-golden.test.ts — #568 段 2 の golden（sha256 固定のスナップショット）。
 *
 * 合成したレイアウト XML・master への追記・[Content_Types]・合成テンプレで書き出した 3 列スライドの
 * slide XML／rels を固定する。値は 2026-11-07 に XML を目で読み（idx 1/2/3 が左→右・等幅・lstStyle の
 * 縮小・cNvPr id 重複なし・creationId 付け替え）、LibreOffice 24.2 で描画を確かめてから採った。
 * 合成規則や書き出しを変えたら、中身を読み直してから更新する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { augmentAndVerify } from "../src/engine/layout-augment";
import { loadTemplate } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DIR = resolve(__dirname, "fixtures/templates");

const MASTER_RELS = "048b01228b7c2d4f390260aa2e08ec36dd577da3e22d1c560f61b95458279aa0";
const DECK_RELS = "fe11b827a409711e106df509505d7f5ddc31830b59e94a032b9fa5322c3c0222";
const GOLDEN: Record<string, Record<string, string>> = {
  "配布資料_公文書高密度_全レイアウト見本.pptx": {
    "ppt/slideLayouts/slideLayout18.xml": "e287a2e30244e6b45a4ef74a8b68417f5ed815a62e6ed72e2cb73cda1b2769cc",
    "ppt/slideMasters/slideMaster1.xml": "57288f614a2102276e8a19bd6f149f78ea22e178626e3d2a6be9fa07cda84f64",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": MASTER_RELS,
    "[Content_Types].xml": "04826b58f692fa5312a5f3e7d232571f47a55c453a2b92ec40f9ea91a0baa6f2",
    "deck:ppt/slides/slide2.xml": "e8826e2c7d8047f2228062bbb64a505afb992a81391bb1169d30a13e3ad42bb1",
    "deck:ppt/slides/_rels/slide2.xml.rels": DECK_RELS,
  },
  // マガジンは #589 で 13_本文（1カラム） が slideLayout18 に入ったため、合成レイアウトは 19 番・master の
  // sldLayoutIdLst／rels・[Content_Types]・書き出した slide2 の rels（layout 参照）が 13 レイアウト fixture と
  // 異なる。slide2.xml 本体（3 列の配置・文字）は #589 の前後で同一（再固定 2026-11-07・統括）。
  "ビジュアルデッキ_マガジン_全レイアウト見本.pptx": {
    "ppt/slideLayouts/slideLayout19.xml": "c428bb612fb5489282e426d10a1ca1bd1314b17bb8bc8d0c4aa1cadde51d4614",
    "ppt/slideMasters/slideMaster1.xml": "33aa6884b756121ddd72fa3860e7d62dbca4bdc36be23e6ceb3bcbff634d9516",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": "0b92822145151e8553afb945a8e06145bd3f303e027b699b5545e3a4fd7b2b20",
    "[Content_Types].xml": "281351ad7a8048b4cbbd8934477cd3d8cd82b6ea0428529601e68f494a72955e",
    "deck:ppt/slides/slide2.xml": "d5e3b59611af90cbc84e4666b8f8b0ef2b9a998af1d84f06a7d2b919fb722016",
    "deck:ppt/slides/_rels/slide2.xml.rels": "2ebad57f4acacdd5b85424d8e80e535a3785b00a7805f8eb367b7a406d278df4",
  },
  "技術報告_スタンダード水色_全レイアウト見本.pptx": {
    "ppt/slideLayouts/slideLayout18.xml": "89501151cad165521522c37de2a969cbde4fd2a95aa46c5393a43848f9f7b72b",
    "ppt/slideMasters/slideMaster1.xml": "45521210de0889e006e0d69afa38bc882be88fead8d579868f172d26f9d7d6fc",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": MASTER_RELS,
    "[Content_Types].xml": "38e0ceab2c48ef0124ecfbb2a66169a3d6d3a4960c7ec07c20d16582e8afefc8",
    "deck:ppt/slides/slide2.xml": "f03553617942d76e99eb1fde04a889475aa50d8f6b657b167a5c2746e3061de3",
    "deck:ppt/slides/_rels/slide2.xml.rels": DECK_RELS,
  },
};

const DECK_MD =
  "# 表紙\n\n---\n\n# 3 列の例\n\n<!-- col -->\n- 第一の論点\n  - 補足\n\n<!-- col -->\n- 中央\n\n<!-- col -->\n- 右";

describe("layout augmentation golden (synthesized layout XML + exported 3-column slide)", () => {
  for (const [file, golden] of Object.entries(GOLDEN)) {
    it(file, async () => {
      const r = await augmentAndVerify(readFileSync(resolve(DIR, file)));
      expect(r.applied).toBe(true);
      // the synthesized layout takes the next free slideLayoutN — 18 for the 13-layout fixtures, 19 for
      // マガジン since #589 added 13_本文（1カラム） as slideLayout18
      const part = Object.keys(golden).find((k) => k.startsWith("ppt/slideLayouts/"))!;
      expect(r.added[0].part).toBe(part);
      const z = await JSZip.loadAsync(r.bytes);
      const deck = await JSZip.loadAsync(await generatePptx(parseMd(DECK_MD), await loadTemplate(r.bytes)));
      for (const [key, hash] of Object.entries(golden)) {
        const [zip, path] = key.startsWith("deck:") ? [deck, key.slice(5)] : [z, key];
        expect(sha(await zip.file(path)!.async("string")), key).toBe(hash);
      }
    });
  }
});
