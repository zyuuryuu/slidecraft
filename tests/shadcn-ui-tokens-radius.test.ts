/**
 * shadcn-ui-tokens-radius.test.ts — #724 PR-A 統括レビュー 要修正 1: shadcn/ui の角丸（`--radius: 0.375rem`）は
 * src/components/ui/*.tsx の中だけが参照し、Tailwind の角丸スケール（rounded-sm/md/lg/xl…）はアプリ全体で既定のまま。
 *
 * shadcn init は `@theme inline { --radius-lg: var(--radius) … }` を足し、アプリ既存の `rounded-lg`（18 か所）が
 * 8px → 6px、`rounded-md` が 6px → 4.8px に変わっていた。ここでは index.css を実際に Tailwind でビルドして、
 * 既定スケールの値を固定する（ビルドの経路＝@tailwindcss/node は vite プラグインと同じコンパイラ）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { compile } from "@tailwindcss/node";

const SRC = resolve(__dirname, "../src");
const UI = join(SRC, "components/ui");
const css = readFileSync(join(SRC, "index.css"), "utf8");

async function build(candidates: string[]): Promise<string> {
  const c = await compile(css, { base: SRC, onDependency: () => {} });
  return c.build(candidates);
}
/** ビルド後の CSS から `.<cls> { border-radius: … }` の値を取り、var(--x) は :root/@theme の定義で 1 段だけ解く。 */
function radiusOf(out: string, cls: string): string {
  // ビルド後の CSS ではセレクタの ( ) が \( \) にエスケープされる → 正規表現では「\ の字」＋「( の字」。
  const esc = cls.replace(/[()[\]*]/g, (ch) => `\\\\\\${ch}`);
  const m = out.match(new RegExp(`\\.${esc} \\{\\s*border-radius: ([^;]+);`));
  if (!m) throw new Error(`no rule for ${cls}`);
  const v = m[1].trim();
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (!ref) return v;
  const def = out.match(new RegExp(`${ref[1]}: ([^;]+);`));
  return def ? def[1].trim() : v;
}

describe("#724 角丸: Tailwind の既定スケールはアプリ全体で不変", () => {
  it.each([
    ["rounded-sm", "0.25rem"],
    ["rounded-md", "0.375rem"],
    ["rounded-lg", "0.5rem"],
    ["rounded-xl", "0.75rem"],
    ["rounded-2xl", "1rem"],
  ])("built CSS の %s は Tailwind 既定（%s）", async (cls, want) => {
    expect(radiusOf(await build([cls]), cls)).toBe(want);
  });

  it("shadcn 部品用の rounded-(--radius) は 0.375rem（6px）を指す", async () => {
    const out = await build(["rounded-(--radius)"]);
    expect(radiusOf(out, "rounded-(--radius)")).toBe("0.375rem");
  });
});

describe("#724 角丸: src/components/ui/*.tsx は Tailwind の角丸スケールを使わず --radius を参照する", () => {
  const files = readdirSync(UI).filter((f) => f.endsWith(".tsx"));
  const SCALE = /(?<![\w-])rounded(?:-[trblse]{1,2})?-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)(?![\w-])|var\(--radius-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)\)/g;

  it.each(files)("%s", (f) => {
    const src = readFileSync(join(UI, f), "utf8");
    expect([...src.matchAll(SCALE)].map((m) => m[0])).toEqual([]);
  });

  it("検出の自己検査: 前置き付き・var() 参照を拾い、rounded-(--radius)・rounded-[2px]・rounded-full は拾わない", () => {
    const sample = "rounded-lg in-data-[slot=x]:rounded-lg **:data-[slot=kbd]:rounded-sm rounded-t-md rounded-[min(var(--radius-md),10px)] rounded-(--radius) rounded-[2px] rounded-full";
    expect([...sample.matchAll(SCALE)].map((m) => m[0])).toEqual(["rounded-lg", "rounded-lg", "rounded-sm", "rounded-t-md", "var(--radius-md)"]);
  });
});
