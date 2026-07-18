/**
 * pathology-census.ts — 実テンプレ群に病理センサス（src/engine/master-pathology）を回し、
 * 機密内容を一切出さずに「構造的病理のチェックリスト＋頻度」を出力する。
 * 設計: docs/design/master-intake.md §3.2。この分布が make-dirty-fixture.ts のミューテーション群と
 * F0b（幾何の床上げ）着手判断の data 的根拠になる。
 *
 * Usage:
 *   npx tsx scripts/pathology-census.ts [template.pptx ...]   # 明示指定
 *   npx tsx scripts/pathology-census.ts                       # 既定＝同梱＋ローカル実テンプレ
 *
 * 出力は「病理の有無とカウント・レイアウト名・寸法・master 数」のみ。テキスト内容・画像・配色は読まない。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { loadTemplate } from "../src/engine/template-loader";
import { detectPathologies, type PathologyKind } from "../src/engine/master-pathology";

const BUNDLED = "public/templates/slide";
const FIX = "tests/fixtures/templates";

// 既定センサス対象＝同梱 4 種（クリーン基準）＋ ローカル実テンプレ（.potx／CX／velis／敵対 fixture）
function defaultPaths(): string[] {
  const bundled = ["Midnight_Executive_30", "技術報告_スタンダード水色", "配布資料_公文書高密度", "ビジュアルデッキ_マガジン"].map(
    (n) => join(BUNDLED, `${n}_TemplateOnly.pptx`),
  );
  const real = [
    "報告書テンプレート.potx",
    "報告書テンプレート_エディトリアル.potx",
    "報告書テンプレート_スタンダード水色.potx",
    "報告書テンプレート_マガジン_生成りコーラル.potx",
    "報告書テンプレート_公文書_白紺.potx",
    "報告書テンプレート_官公庁.potx",
    "配布資料_公文書高密度.potx",
    "CX_sample_MSGothic.pptx",
    "lrk-slides-velis_CC0.pptx",
    "Dirty_Adversarial_TemplateOnly.pptx",
    "Dirty_AllBody_TemplateOnly.pptx",
    "Dirty_Legacy43_TemplateOnly.pptx",
    "Dirty_Grouped_TemplateOnly.pptx",
  ].map((n) => join(FIX, n));
  return [...bundled, ...real].filter(existsSync);
}

/** ローダーは slideMaster1 固定なので、複数 master は zip から直接数える（部品0 の未対応）。 */
async function masterCount(bytes: Uint8Array): Promise<number> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files).filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)).length;
}

const KIND_LABEL: Record<PathologyKind | "multiple-masters", string> = {
  "unresolved-geometry": "幾何未解決(w/h=0)",
  "typeless-placeholder": "type無しph",
  "title-as-static-text": "title=生text",
  "title-as-body": "title=body型",
  "figure-as-body": "figure=body型",
  "no-title-role": "title role皆無",
  "non-standard-slide-size": "非16:9",
  "multiple-masters": "複数master",
};

async function main() {
  const args = process.argv.slice(2);
  const paths = args.length ? args : defaultPaths();
  if (paths.length === 0) {
    console.error("no templates. Usage: npx tsx scripts/pathology-census.ts [template.pptx ...]");
    process.exit(1);
  }

  const agg: Record<string, { findings: number; templates: number }> = {};
  const bump = (kind: string, n: number) => {
    agg[kind] ??= { findings: 0, templates: 0 };
    agg[kind].findings += n;
    if (n > 0) agg[kind].templates += 1;
  };

  for (const p of paths) {
    if (!existsSync(p)) {
      console.error(`skip (missing): ${p}`);
      continue;
    }
    const bytes = readFileSync(p);
    const tpl = await loadTemplate(bytes);
    const name = p.split("/").pop() ?? p;
    const r = detectPathologies(tpl, name);
    const mc = await masterCount(bytes);

    const badges: string[] = [];
    for (const [kind, n] of Object.entries(r.counts)) {
      badges.push(`${KIND_LABEL[kind as PathologyKind]}×${n}`);
      bump(kind, n as number);
    }
    if (mc > 1) {
      badges.push(`${KIND_LABEL["multiple-masters"]}×${mc}`);
      bump("multiple-masters", mc);
    } else {
      bump("multiple-masters", 0);
    }
    for (const k of Object.keys(r.counts)) void k; // (bump 済)

    const sz = `${r.slideSize.w.toFixed(1)}×${r.slideSize.h.toFixed(1)}`;
    const head = `\x1b[1m${name}\x1b[0m  (${tpl.layouts.length}layouts ${sz} master×${mc})`;
    console.log(`\n${badges.length ? "🚩" : "✅"} ${head}`);
    console.log(`   ${badges.length ? badges.join("  ") : "\x1b[32mclean\x1b[0m"}`);
    // レイアウト別の内訳（先頭 8 件まで）
    for (const f of r.findings.slice(0, 8))
      console.log(`     - ${KIND_LABEL[f.kind]}  [${f.layout ?? "template"}]  ${f.detail}`);
    if (r.findings.length > 8) console.log(`     … ほか ${r.findings.length - 8} 件`);
  }

  // 集計（病理×何テンプレに・総件数）
  console.log(`\n\x1b[1m===== 病理センサス集計（${paths.length} テンプレ）=====\x1b[0m`);
  const rows = Object.entries(agg)
    .filter(([, v]) => v.findings > 0)
    .sort((a, b) => b[1].templates - a[1].templates || b[1].findings - a[1].findings);
  for (const [kind, v] of rows)
    console.log(`  ${(KIND_LABEL[kind as PathologyKind] ?? kind).padEnd(20)}  ${String(v.templates).padStart(2)}/${paths.length} テンプレ  計${v.findings}件`);
}

void main();
