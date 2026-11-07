/**
 * no-builtin-layout-name-fallback.test.ts — #117（統括裁定 B）: テンプレが無いときの fallback が、
 * Midnight の 30 レイアウトのファイル順（LAYOUT_NAMES の index）に依存していないことを検査する。
 *
 * LAYOUT_NAMES / BUILTIN_LAYOUTS は SlideCraft の canonical なレイアウト語彙として残す（テンプレ作成・
 * llm-prompts が使う）。除去するのは「テンプレ無し時に 30 種の名前一覧を固定で引く」経路だけ：
 * - template-loader の slideRoleRegions: `LAYOUT_NAMES[n]` の index 引き → role で引く表に置換
 * - SlideEditor のレイアウト選択: テンプレが無ければ `auto` だけ（30 種名を並べない）
 * - Editor（Markdown）の `<!-- slide: -->` 補完: 読み込み中テンプレのレイアウト名で補完する
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(__dirname, "../src", p), "utf8");

describe("テンプレ無し時の fallback に 30 種名の固定一覧が残っていない（#117 B）", () => {
  it("src/ に LAYOUT_NAMES の index 引き（LAYOUT_NAMES[n]）が無い", () => {
    const files = ["engine/template-loader.ts", "components/SlideEditor.tsx", "components/Editor.tsx", "engine/llm-prompts.ts"];
    for (const f of files) expect(src(f), f).not.toMatch(/LAYOUT_NAMES\s*\[/);
  });

  it("SlideEditor / Editor は LAYOUT_NAMES を fallback に使わない（import していない）", () => {
    expect(src("components/SlideEditor.tsx")).not.toMatch(/\bLAYOUT_NAMES\b/);
    expect(src("components/Editor.tsx")).not.toMatch(/\bLAYOUT_NAMES\b/);
  });

  it("起動経路（useMasterRegistry / useDeckController）に Midnight の名前が残っていない", () => {
    expect(src("components/useMasterRegistry.ts")).not.toMatch(/Midnight/);
    expect(src("components/useDeckController.ts")).not.toMatch(/Midnight/);
  });
});
