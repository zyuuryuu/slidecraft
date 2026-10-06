/**
 * fix-nested-bullet-sizes.ts — one-off: 同梱テンプレのレイアウト本文 lstStyle のネスト段（lvl≥2）
 * サイズを lvl1 の縮小に追随させる (#449)。
 *
 * 病理（2 形態・どちらも「ネスト箇条書きが親より大きい」として現れる）:
 *  - A) lstStyle が lvl1pPr（例: 技術報告 本文 sz=1600）だけを持つ → lvl2 以降が master bodyStyle の
 *       lvl2pPr sz=2800 / lvl3pPr sz=2400 に落ち、16pt の親の下に 28pt のネストが出る。
 *  - B) lstStyle が lvl2〜9pPr を持つが、master 基準（lvl1=3200）のサイズのまま lvl1 だけ後から
 *       縮めてある（例: 03_本文（2カラム） lvl1=1500 / lvl2=2400）。
 *
 * 修正: lvl1 の縮小率（lvl1 上書き ÷ master lvl1）を係数として、
 *  - 既存の lvlNpPr sz が lvl1 上書きを超えるものは同係数で縮める（B。属性・バレットは保持）、
 *  - lvl2〜4pPr が無ければ lvl1pPr を複製し master の lvlN sz × 係数で追記する（A。algn・b・色は
 *    lvl1 と同じ、marL/indent/バレットは master の lvlNpPr から通常継承）。
 * sz は 50（0.5pt）単位へ丸め、[1pt, lvl1] にクランプ。master の段差比がそのまま保たれる
 * （例: 1600 → 1400/1200/1000）。export のネスト深さは MAX_NEST_LEVEL=3（paragraph-nesting.ts）
 * なので lvl4pPr までの追記で全段を覆う（既存 lvl5〜9 の逆転はついでに同係数で直す）。
 *
 * add-body-bullet-style.ts と同じく既存パートの in-place パッチ。一度実行して結果をコミットする
 * （public/ と tests/fixtures/ の対応物）。冪等: 逆転が残っていない lstStyle には触れない。
 *
 * Usage: npx tsx scripts/fix-nested-bullet-sizes.ts
 */
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// 出荷テンプレ（public/）とその fixtures 対応物（全レイアウト見本 = 同じマスター/レイアウト）。
// Midnight は master bodyStyle が lvl1 のみ（lvl2 以降はローダの段階縮小が効く）ので対象外。
// fixtures の 報告書テンプレート_* は出荷物ではない intake 試験コーパスなので触らない。
const PATHS = [
  "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx",
  "public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  "public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx",
  "tests/fixtures/templates/技術報告_スタンダード水色_全レイアウト見本.pptx",
  "tests/fixtures/templates/ビジュアルデッキ_マガジン_全レイアウト見本.pptx",
  "tests/fixtures/templates/配布資料_公文書高密度_全レイアウト見本.pptx",
];

/** master bodyStyle の lvl1〜9pPr defRPr sz（1/100pt）。無い段は undefined。 */
function masterLevelSizes(masterXml: string): (number | undefined)[] {
  const body = masterXml.match(/<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/)?.[0] ?? "";
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
    const block = body.match(new RegExp(`<a:lvl${n}pPr\\b[\\s\\S]*?<\\/a:lvl${n}pPr>`))?.[0];
    const sz = block?.match(/defRPr[^>]*\bsz="(\d+)"/)?.[1];
    return sz ? parseInt(sz) : undefined;
  });
}

/** 本文 placeholder の lstStyle を lvl1 縮小率に追随させたレイアウト XML（と修正 placeholder 数）。 */
function patchLayout(xml: string, mSizes: (number | undefined)[]): { xml: string; patched: number } {
  const m1 = mSizes[0];
  if (!m1) return { xml, patched: 0 };
  let patched = 0;
  const out = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
    if (!/<p:ph\b/.test(sp)) return sp; // 装飾 shape は対象外
    // type 属性なしの <p:ph idx="1"/> は OOXML 既定で body（template-loader と同じ解釈）
    const phType = sp.match(/<p:ph\b[^>]*type="(\w+)"/)?.[1] ?? "body";
    if (phType !== "body") return sp;
    const lst = sp.match(/<a:lstStyle>[\s\S]*?<\/a:lstStyle>/)?.[0];
    const lvl1 = lst?.match(/<a:lvl1pPr\b[\s\S]*?<\/a:lvl1pPr>/)?.[0];
    const sz1 = lvl1?.match(/defRPr[^>]*\bsz="(\d+)"/)?.[1];
    if (!lst || !lvl1 || !sz1) return sp; // lvl1 がサイズを縮めていなければ master の段差のままで正しい
    const base = parseInt(sz1);
    if (base >= m1) return sp; // 縮小でなく拡大なら master の lvl2〜 は既に lvl1 以下
    const scale = (authored: number) =>
      Math.max(100, Math.min(base, Math.round((authored * base) / m1 / 50) * 50));
    let newLst = lst;
    let touched = false;
    for (let n = 2; n <= 9; n++) {
      const block = newLst.match(new RegExp(`<a:lvl${n}pPr\\b[\\s\\S]*?<\\/a:lvl${n}pPr>`))?.[0];
      const mN = mSizes[n - 1];
      if (block) {
        // B) 既存段: sz が lvl1 を超えていれば同係数で縮小（sz 無しなら master lvlN に落ちる →
        //    export が使う lvl4 までは sz を注入して防ぐ）
        const szN = block.match(/defRPr[^>]*\bsz="(\d+)"/)?.[1];
        if (szN && parseInt(szN) > base) {
          newLst = newLst.replace(block, block.replace(/(defRPr[^>]*\bsz=")\d+"/, `$1${scale(parseInt(szN))}"`));
          touched = true;
        } else if (!szN && n <= 4 && mN && mN > base) {
          newLst = newLst.replace(block, block.replace(/<a:defRPr\b/, `<a:defRPr sz="${scale(mN)}"`));
          touched = true;
        }
      } else if (n <= 4 && mN && mN > base) {
        // A) 欠落段: lvl1pPr を複製して master lvlN × 係数の sz で追記
        const clone = lvl1
          .replace(/<a:lvl1pPr\b/, `<a:lvl${n}pPr`)
          .replace(/<\/a:lvl1pPr>/, `</a:lvl${n}pPr>`)
          .replace(/(defRPr[^>]*\bsz=")\d+"/, `$1${scale(mN)}"`);
        newLst = newLst.replace(/<\/a:lstStyle>/, `${clone}</a:lstStyle>`);
        touched = true;
      }
    }
    if (!touched) return sp;
    patched++;
    return sp.replace(lst, newLst);
  });
  return { xml: out, patched };
}

async function run() {
  for (const relPath of PATHS) {
    const path = resolve(relPath);
    const zip = await JSZip.loadAsync(readFileSync(path));
    const master = await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
    const mSizes = masterLevelSizes(master);
    let total = 0;
    const layoutNames = Object.keys(zip.files)
      .filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f));
    for (const name of layoutNames) {
      const xml = await zip.file(name)!.async("string");
      const r = patchLayout(xml, mSizes);
      if (r.patched > 0) {
        zip.file(name, r.xml);
        total += r.patched;
      }
    }
    if (total === 0) {
      console.log(`  ${relPath}: no inverted nested-bullet sizes found — skipping (idempotent)`);
      continue;
    }
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    writeFileSync(path, buf);
    console.log(`  ${relPath}: nested-bullet sizes fixed on ${total} body placeholders (lvl1-ratio scaled)`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
