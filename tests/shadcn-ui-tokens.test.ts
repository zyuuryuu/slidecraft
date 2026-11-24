/**
 * shadcn-ui-tokens.test.ts — #724: shadcn/ui からコピーした部品（src/components/ui/*.tsx）が、アプリと意味の違う
 * 色名を使っていないことを確かめる。
 *
 * shadcn の `--muted`／`--accent` は「薄い塗り」、アプリの `--muted`／`--accent` は「薄い文字色」「主色」。名前が
 * 同じで意味が違うので、アプリ側は改名せず、コピーした部品の側を置き換える（統括の決定 3）。置換ルールの
 * 本文は src/components/ui/README.md。`shadcn add` のたびに当て忘れると、たとえばメニュー項目のホバーが
 * 主色の塗りになる（bg-accent）。ここはその当て忘れを CI で止める。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const UI = resolve(__dirname, "../src/components/ui");
const files = readdirSync(UI).filter((f) => f.endsWith(".tsx"));

/** shadcn の意味のまま残してはいけない class（variant 前置き hover: 等や /opacity が付いても拾う）。 */
const FORBIDDEN: Array<{ re: RegExp; use: string }> = [
  { re: /(?<![\w-])bg-muted(?![\w-])/g, use: "bg-surface" },
  { re: /(?<![\w-])bg-accent(?![\w-])/g, use: "bg-edge" },
  { re: /(?<![\w-])text-muted-foreground(?![\w-])/g, use: "text-muted" },
  { re: /(?<![\w-])text-accent-foreground(?![\w-])/g, use: "text-fg" },
];

describe("#724 src/components/ui/* は shadcn の muted／accent を使わない（README の置換ルール）", () => {
  it("部品が 1 つ以上ある（数え漏れの防止）", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s", (f) => {
    const src = readFileSync(join(UI, f), "utf8");
    const hits = FORBIDDEN.flatMap(({ re, use }) => [...src.matchAll(re)].map((m) => `${m[0]} → ${use}`));
    expect(hits).toEqual([]);
  });

  it("検出の自己検査: variant 前置き・/opacity 付きも拾い、text-muted・bg-accent-hi は拾わない", () => {
    const sample = 'hover:bg-muted aria-expanded:bg-muted dark:hover:bg-muted/50 focus:bg-accent text-muted text-muted-foreground bg-accent-hi';
    const hits = FORBIDDEN.flatMap(({ re }) => [...sample.matchAll(re)].map((m) => m[0]));
    expect(hits).toEqual(["bg-muted", "bg-muted", "bg-muted", "bg-accent", "text-muted-foreground"]);
  });
});
