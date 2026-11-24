// @vitest-environment jsdom
/**
 * toolbar-bartip-724.test.tsx — #724 PR-A 統括レビュー 要修正 2・3・4・5・6: 上部バーの説明（BarTip＝shadcn の Tooltip）。
 *
 *  2. Base UI の Tooltip は role="tooltip" も aria-describedby も付けない。以前の `title=` が支援技術に渡していた説明
 *     （📝 の用途・ロック中の理由・🎨・✨ AI・⚙・↶ ↷）を、BarTip が常に描く説明要素＋aria-describedby で渡す。
 *     文言は 1 つの label を Tooltip と説明要素の両方に使う（R8）→ 開いた Tooltip の文字と一致すること。
 *  3. メニューを開いている入口（aria-expanded="true"）では Tooltip を開かない（メニュー先頭行に重ならない）。
 *  4. フォーカスリングは --ring（＝--fg）の不透明な色。主ボタン（bg-primary＝--accent）の上でも地と分かれる。
 *  5. disabled の切替で Button が作り直されない（要素構造が同じ＝フォーカスや参照が保たれる）。
 *  6. TooltipProvider はアプリ全体に 1 つ（main.tsx）＝原稿入力ダイアログの 🎨 も同じ遅延。
 * 「ファイル」ボタンは main でも title= を持たない（説明なし）ので、説明を持つのは 7 ボタンのうち 6 つ。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import i18n from "../src/i18n";
import Toolbar from "../src/components/Toolbar";
import MasterPicker from "../src/components/MasterPicker";
import type { MasterEntry } from "../src/components/useMasterRegistry";
import { BAR_TOOLTIP_DELAY } from "../src/components/bar-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;
const masters: MasterEntry[] = [{ id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true }];

beforeAll(async () => {
  document.documentElement.setAttribute("data-theme", "dark");
  await i18n.changeLanguage("ja");
});

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

type BarProps = Partial<Parameters<typeof Toolbar>[0]> & { masterDisabled?: boolean };
const bar = ({ masterDisabled, ...p }: BarProps = {}): ReactElement => (
  <Toolbar
    onSave={noop} onGenerate={noop} onExportHtml={noop} onSaveProject={noop} onOpenProject={noop} onAiAssist={noop}
    generating={false} hasSpec onUndo={noop} onRedo={noop} canUndo canRedo onHelp={noop} onAiSettings={noop} onDraft={noop}
    master={<MasterPicker masters={masters} activeId="builtin-gijutsu" disabled={masterDisabled} onSelect={noop} onImport={noop} onRemake={noop} onCreate={noop} />}
    {...p}
  />
);
async function mount(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}
const rerender = (node: ReactElement) => act(async () => root!.render(node));

/** 上部バーのボタン（テキストの先頭で探す）。 */
function btn(start: string): HTMLButtonElement {
  const b = [...document.querySelectorAll<HTMLButtonElement>("[data-testid=top-bar] button")].find((x) => (x.textContent ?? "").trim().startsWith(start));
  if (!b) throw new Error(`no button ${start}`);
  return b;
}
/** aria-describedby の参照先の文字（無ければ null）。 */
function described(b: Element): string | null {
  const ids = b.getAttribute("aria-describedby");
  if (!ids) return null;
  return ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "<missing>").join(" ");
}
const tooltipText = () => document.querySelector("[data-slot=tooltip-content]")?.firstChild?.textContent ?? null;
const openTip = (b: HTMLElement) => act(async () => { b.focus(); b.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });

describe("#724 要修正 2: 説明（以前の title=）が aria-describedby で支援技術に届く", () => {
  it("6 ボタンの説明が辞書の文言と一致し、ファイルは説明なし（main でも title= なし）", async () => {
    await mount(bar());
    expect(described(btn("↶"))).toBe(t("toolbar.undo"));
    expect(described(btn("↷"))).toBe(t("toolbar.redo"));
    expect(described(btn(t("toolbar.draft")))).toBe(t("app.draftButtonTitle"));
    expect(described(btn("🎨"))).toBe(t("masterPicker.buttonTitle"));
    expect(described(btn(t("toolbar.aiLabel")))).toBe(t("toolbar.aiTitle"));
    expect(described(btn("⚙"))).toBe(t("settings.buttonTitle"));
    expect(described(btn(t("toolbar.file")))).toBeNull();
  });

  it("状態で変わる説明（ロック中の 📝・AI 実行中・協働中・押せない ↶）も届く", async () => {
    await mount(bar({ draftGate: "locked", aiRunning: 2, canUndo: false }));
    expect(described(btn(t("toolbar.draft")))).toBe(t("app.draftGateLocked"));
    expect(described(btn(t("toolbar.aiLabel")))).toBe(t("toolbar.aiRunningTitle", { n: 2 }));
    expect(described(btn("↶"))).toBe(t("toolbar.undo"));
    await rerender(bar({ aiCollabActive: true }));
    expect(described(btn(t("toolbar.aiCollabLabel")))).toBe(t("toolbar.aiCollabTitle"));
  });

  it("説明要素は名前に混ざらない（ボタンの外・画面には出ない）", async () => {
    await mount(bar());
    for (const s of ["↶", "⚙", "🎨"]) {
      const b = btn(s);
      const el = document.getElementById(b.getAttribute("aria-describedby")!)!;
      expect(b.contains(el)).toBe(false);
      expect(el.hidden).toBe(true);
    }
  });

  it("R8: 開いた Tooltip の文字＝説明要素の文字（1 つの label を両方に使う）", async () => {
    await mount(bar());
    const b = btn(t("toolbar.draft"));
    await openTip(b);
    expect(tooltipText()).toBe(t("app.draftButtonTitle"));
    expect(tooltipText()).toBe(described(b));
  });
});

describe("#724 要修正 3: メニューを開いている入口では Tooltip を開かない", () => {
  it("⚙ を開いた状態で ⚙ にフォーカス／ホバーしても Tooltip は出ない（閉じている ⚙ では出る）", async () => {
    await mount(bar());
    const gear = btn("⚙");
    await openTip(gear);
    expect(tooltipText()).toBe(t("settings.buttonTitle")); // 道具の自己検査: 閉じている入口では開く
    await act(async () => gear.click());
    expect(gear.getAttribute("aria-expanded")).toBe("true");
    await openTip(gear);
    expect(document.querySelector("[data-slot=tooltip-content]")).toBeNull();
  });

  it("⚙ を開いたまま ⚙ にポインタを乗せ直しても、遅延を過ぎて Tooltip は出ない", async () => {
    await mount(bar());
    const gear = btn("⚙");
    await act(async () => gear.click());
    expect(gear.getAttribute("aria-expanded")).toBe("true");
    const trigger = gear.parentElement!; // BarTip の span（Tooltip の trigger）
    await hover(trigger);
    expect(document.querySelector("[data-slot=tooltip-content]")).toBeNull();
    // 道具の自己検査: 閉じた入口（📝）には同じ操作で出る
    await hover(btn(t("toolbar.draft")).parentElement!);
    expect(tooltipText()).toBe(t("app.draftButtonTitle"));
  });
});

/** ポインタを乗せ、Provider 無しの既定遅延（600ms）を過ぎるまで待つ。 */
async function hover(el: HTMLElement) {
  await act(async () => {
    for (const type of ["pointerenter", "pointerover", "mouseenter", "mouseover", "pointermove", "mousemove"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: !type.endsWith("enter"), clientX: 1, clientY: 1 }));
    }
    await new Promise((r) => setTimeout(r, 700));
  });
}

describe("#724 要修正 5: disabled の切替で Button を作り直さない", () => {
  it("↶・📝・🎨 は disabled ⇄ 有効で同じ DOM 要素のまま", async () => {
    await mount(bar());
    const before = [btn("↶"), btn(t("toolbar.draft")), btn("🎨")];
    await rerender(bar({ canUndo: false, draftGate: "busy", masterDisabled: true }));
    const mid = [btn("↶"), btn(t("toolbar.draft")), btn("🎨")];
    expect(mid.map((b) => b.disabled)).toEqual([true, true, true]);
    await rerender(bar());
    const after = [btn("↶"), btn(t("toolbar.draft")), btn("🎨")];
    mid.forEach((b, i) => expect(b).toBe(before[i]));
    after.forEach((b, i) => expect(b).toBe(before[i]));
  });

  it("有効なまま状態が変わってもフォーカスは残る（📝 のロック解除 → 有効のまま説明だけ変わる等）", async () => {
    await mount(bar({ aiRunning: 0 }));
    const ai = btn(t("toolbar.aiLabel"));
    ai.focus();
    await rerender(bar({ aiRunning: 1 }));
    expect(document.activeElement).toBe(ai);
  });
});

/* ── 要修正 4・6 はソースとトークンで確かめる ───────────────────────────────────────────────── */
const SRC = resolve(__dirname, "../src");
const css = readFileSync(join(SRC, "index.css"), "utf8");
function themeVar(theme: "dark" | "light" | "modern", name: string): string {
  const block = (sel: RegExp) => css.match(sel)?.[1] ?? "";
  const dark = block(/:root,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/);
  const own = theme === "dark" ? dark : block(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  const find = (b: string) => b.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
  const v = find(own) ?? find(dark);
  if (!v) throw new Error(`${theme} ${name}`);
  return v;
}
function lum(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("#724 要修正 4: フォーカスリングは地（上部バー・ダイアログ見出し）に対して 3:1 以上（WCAG 2.4.13）", () => {
  const button = readFileSync(join(SRC, "components/ui/button.tsx"), "utf8");
  it("--ring は --fg の別名で、button は不透明の ring-ring（/50 のハローでない）", () => {
    expect(css).toMatch(/--ring:\s*var\(--fg\);/);
    expect(button).toMatch(/focus-visible:ring-2 focus-visible:ring-ring(?![\w/-])/);
    expect(button).not.toMatch(/focus-visible:ring-ring\/\d+/);
  });
  it.each(["dark", "light", "modern"] as const)("%s: リング（--fg）対 上部バー（--surface）・原稿入力の見出し（--void）", (th) => {
    const fg = themeVar(th, "--fg");
    expect(contrast(fg, themeVar(th, "--surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(fg, themeVar(th, "--void"))).toBeGreaterThanOrEqual(3);
  });
});

describe("#724 要修正 6: TooltipProvider はアプリに 1 つ（main.tsx で App を包む）", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
  it("<TooltipProvider を描くのは main.tsx だけ（ui/tooltip.tsx の定義を除く）・遅延は BAR_TOOLTIP_DELAY", () => {
    const users = walk(SRC).filter((p) => !p.endsWith(join("ui", "tooltip.tsx")) && /<TooltipProvider\b/.test(readFileSync(p, "utf8")));
    expect(users.map((p) => p.slice(SRC.length + 1))).toEqual(["main.tsx"]);
    expect(readFileSync(join(SRC, "main.tsx"), "utf8")).toMatch(/<TooltipProvider delay=\{BAR_TOOLTIP_DELAY\}>\s*<App \/>\s*<\/TooltipProvider>/);
    expect(BAR_TOOLTIP_DELAY).toBe(400);
  });
});
