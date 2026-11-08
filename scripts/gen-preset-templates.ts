/**
 * gen-preset-templates.ts — スタイル・プリセット（src/engine/template-presets.ts）から、出荷テンプレと
 * 全レイアウト見本（golden fixture）を決定論的に書き出す（#595〜・#580 段 2）。
 *
 *  - TemplateOnly: writePresetTemplate(preset) そのもの（public/templates/slide/ に置いて BUILTIN_MASTERS へ登録）。
 *  - 全レイアウト見本: 見本 Markdown（1 枚 1 レイアウト）を、その TemplateOnly で MCP と同じ経路
 *    （newProject → exportPptxBytes）で書き出したもの（tests/fixtures/templates/）。
 * zip のエントリ日時だけは生成時刻で変わるので固定する（再実行してもファイルが 1 byte も変わらない）。
 * 中身（全パート）の一致は tests/pitch-preset-595.test.ts 等が part 単位で検査する（R8: プリセット表と出荷物）。
 *
 * 成果物を足すときは PRESET_ARTIFACTS の末尾に 1 行足す。
 * Usage: npx tsx scripts/gen-preset-templates.ts
 */
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writePresetTemplate, PITCH_PRESET, type StylePreset } from "../src/engine/template-presets";
import * as S from "../src/mcp/session";

export interface PresetArtifact {
  preset: StylePreset;
  templateOnly: string; // repo 相対
  showcase: string; // repo 相対（全レイアウト見本 .pptx）
  showcaseMarkdown: string; // repo 相対（見本の原稿）
}

export const PRESET_ARTIFACTS: readonly PresetArtifact[] = [
  {
    preset: PITCH_PRESET,
    templateOnly: "public/templates/slide/セールスピッチ_Pitch_TemplateOnly.pptx",
    showcase: "tests/fixtures/templates/セールスピッチ_Pitch_全レイアウト見本.pptx",
    showcaseMarkdown: "tests/fixtures/templates/セールスピッチ_Pitch_全レイアウト見本.md",
  },
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

/** 同じパートを同じ順で、エントリ日時だけ固定して詰め直す。 */
async function withFixedDates(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await JSZip.loadAsync(bytes);
  const out = new JSZip();
  for (const name of Object.keys(src.files)) {
    const f = src.files[name];
    if (f.dir) continue;
    out.file(name, await f.async("uint8array"), { date: FIXED_DATE, createFolders: false });
  }
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildTemplateOnly(a: PresetArtifact): Promise<Uint8Array> {
  return withFixedDates(await writePresetTemplate(a.preset));
}

export async function buildShowcase(a: PresetArtifact, templateOnly?: Uint8Array): Promise<Uint8Array> {
  const s = S.createSession(null);
  await S.newProject(s, templateOnly ?? (await buildTemplateOnly(a)), readFileSync(join(ROOT, a.showcaseMarkdown), "utf8"));
  return withFixedDates((await S.exportPptxBytes(s)).bytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    for (const a of PRESET_ARTIFACTS) {
      const tpl = await buildTemplateOnly(a);
      writeFileSync(join(ROOT, a.templateOnly), tpl);
      writeFileSync(join(ROOT, a.showcase), await buildShowcase(a, tpl));
      process.stdout.write(`${a.preset.name}: ${a.templateOnly} / ${a.showcase}\n`);
    }
  })();
}
