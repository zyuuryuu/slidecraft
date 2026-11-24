// @vitest-environment jsdom
/**
 * ux-followups-739.test.tsx — #739: #724 段 1 PR-B（#738）の統括レビューで出た重大度 1 の所見 5 件。
 *
 *  1. BarTip の「戻ってきたフォーカスでは Tooltip を開かない」抑止は、メニューが外側クリックで閉じてフォーカスが
 *     入口以外へ移ったら解除する（次に Tab で入口へ来たとき Tooltip が出る・Nielsen 1）。
 *  2. 押せない項目（aria-disabled）は title を持たない。DropdownMenu の項目は data-disabled で pointer-events-none
 *     なので、title はホバーで読めない。理由は見える note に一本化する（Nielsen 1）。
 *  3. 2 つのダイアログ（原稿入力・テンプレートを作成）の × は同じ名前 dialog.close（WCAG 4.1.2／Nielsen 4）。
 *  4. e2e は role="dialog" を名前付きで探す（Base UI の Popover.Popup も role="dialog" なので誤一致し得る）。
 *  5. 便利スライドの生成メニュー（📑）は BarMenu（DropdownMenu）: role="menu" が Portal に出て、Esc で閉じて
 *     フォーカスが入口に戻る。手製の outside-click／mousedown は持たない（Nielsen 4）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import i18n from "../src/i18n";
import Toolbar from "../src/components/Toolbar";
import MasterPicker from "../src/components/MasterPicker";
import { MasterMenu } from "../src/components/MasterMenu";
import { DropdownMenu } from "../src/components/ui/dropdown-menu";
import InitializeModal from "../src/components/InitializeModal";
import TemplateCreator from "../src/components/TemplateCreator";
import GenerateSlideMenu from "../src/components/GenerateSlideMenu";
import type { AugmentPlan } from "../src/engine/layout-augment-plan";
import type { MasterEntry } from "../src/components/useMasterRegistry";

// Monaco and the slide renderer are not what this test is about (and do not run in jsdom).
vi.mock("../src/components/Editor", () => ({ default: () => <textarea data-testid="editor-stub" /> }));
vi.mock("../src/components/SlidePreview", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  default: () => <div data-testid="preview-stub" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const t = (k: string) => i18n.t(k) as string;
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
async function mount(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const press = (el: HTMLElement) => act(async () => { el.click(); });
const key = (el: Element, k: string) =>
  act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
/** 外側のクリック（target の上で pointerdown〜click）。 */
const clickOn = (target: Element) =>
  act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
  });
const menu = () => document.querySelector<HTMLElement>("[role=menu]");
const tip = () => document.querySelector("[data-slot=tooltip-content]");

const bar = () => (
  <Toolbar
    onSave={noop} onGenerate={noop} onExportHtml={noop} onSaveProject={noop} onOpenProject={noop} onAiAssist={noop}
    generating={false} hasSpec onUndo={noop} onRedo={noop} canUndo canRedo onHelp={noop} onAiSettings={noop} onDraft={noop}
    master={<MasterPicker masters={masters} activeId="builtin-gijutsu" onSelect={noop} onImport={noop} />}
  />
);
function barButton(start: string): HTMLButtonElement {
  const b = [...document.querySelectorAll<HTMLButtonElement>("[data-testid=top-bar] button")].find((x) => (x.textContent ?? "").trim().startsWith(start));
  if (!b) throw new Error(`no button ${start}`);
  return b;
}

/* 実測（Chromium・PR 本文）: 外側のクリックは Base UI の modal メニューが敷く背景（data-base-ui-inert）が受け、
 * フォーカスは入口に戻る（＝抑止してよい「戻ってきたフォーカス」）。抑止が残るのは、Tab でメニューの外へ出て
 * （フォーカスは入口の次の 📑 等へ）、Shift+Tab で入口に戻ったとき。jsdom には背景の当たり判定も Tab の
 * フォーカスガードも無いので、同じ状態（メニューが閉じ、フォーカスは入口を経由せず外にある）を「外のボタンの
 * mousedown でフォーカスが移る」で作る。実ブラウザの Tab 経路は tests/e2e/ux-followups-739.spec.ts。 */
describe("#739-1 BarTip: メニューが閉じてフォーカスが入口以外へ移ったら、次に入口へ来たフォーカスでは抑止しない", () => {
  it("⚙ を開く → フォーカスが外のボタンへ移って閉じる → そこから ⚙ に戻る（Shift+Tab）→ Tooltip が出る", async () => {
    await mount(bar());
    const outsideBtn = document.createElement("button");
    outsideBtn.textContent = "outside";
    document.body.appendChild(outsideBtn);
    const gear = barButton("⚙");
    await press(gear);
    expect(menu()).not.toBeNull();
    const fire = (type: string) => outsideBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    await act(async () => { fire("pointerdown"); fire("mousedown"); outsideBtn.focus(); fire("pointerup"); fire("mouseup"); fire("click"); });
    await settle();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(outsideBtn); // the trigger was never refocused (no blur clears the flag)
    await act(async () => { // Shift+Tab back: the focus comes from the outside button, not from the menu
      gear.focus();
      gear.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: outsideBtn }));
    });
    await settle();
    expect(tip()?.textContent).toContain(t("settings.buttonTitle"));
  });
});

describe("#739-2 押せない項目は title を持たない（理由は見える note に一本化）", () => {
  it("🎨 の「テンプレートを強化」が押せないとき: title なし・理由は項目の文字に出る", () => {
    const plan = { rule: null, add: [], skipped: [], reason: "元にするレイアウトがありません" } as unknown as AugmentPlan;
    const html = renderToStaticMarkup(
      <DropdownMenu>
        <MasterMenu masters={masters} activeId="builtin-gijutsu" onSelect={noop} augment={{ plan, onAugment: noop }} />
      </DropdownMenu>,
    );
    const tag = html.match(/<button[^>]*data-testid="master-augment"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).not.toMatch(/\stitle="/);
    expect(html).toContain(plan.reason);
  });

  it("どのメニューでも aria-disabled の項目に title は無い（📑 の「作り直す」も）", async () => {
    await mount(<GenerateSlideMenu hasActiveSlide={false} onInsert={noop} onRegenerateActive={noop} />);
    await press(document.querySelector<HTMLButtonElement>("button")!);
    await press([...menu()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === t("generateSlide.modeStatic"))!);
    const disabled = [...menu()!.querySelectorAll<HTMLElement>("[role=menuitem][aria-disabled=true]")];
    expect(disabled.length).toBeGreaterThan(0); // 道具の自己検査: 押せない項目がある状態を描けている
    for (const el of disabled) expect(el.hasAttribute("title"), el.textContent ?? "").toBe(false);
  });
});

describe("#739-3 2 つのダイアログの × は同じ名前（dialog.close）", () => {
  const closeButton = () =>
    [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((b) => ["×", "✕"].includes((b.textContent ?? "").trim()));

  it("原稿入力の × は aria-label=dialog.close", async () => {
    await mount(
      <InitializeModal
        isOpen onCancel={noop} onConfirm={noop} mdText="# a" onMdChange={noop} onOpenFile={noop} onStructure={noop} onGenerateAI={noop}
        masters={masters} activeMasterId="builtin-gijutsu" onSelectMaster={noop} onImportMaster={noop} onRemakeMaster={noop}
        deck={null} templateData={null} parseError={null} activeSlide={0} onSlideClick={noop} warnIssues={[]} tipIssues={[]}
        onFixDeterministic={noop} onCursorLine={noop}
      />,
    );
    await settle();
    expect(closeButton()?.getAttribute("aria-label")).toBe(t("dialog.close"));
  });

  it("テンプレートを作成の × は aria-label=dialog.close", async () => {
    await mount(<TemplateCreator isOpen onCancel={noop} onCreate={async () => {}} />);
    await settle();
    expect(closeButton()?.getAttribute("aria-label")).toBe(t("dialog.close"));
  });
});

describe("#739-4 e2e は role=dialog を名前付きで探す（Popover も role=dialog）", () => {
  it("tests/e2e の getByRole(\"dialog\") はすべて name を渡す", () => {
    const dir = resolve(__dirname, "e2e");
    const bare = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").map((line, i) => ({ at: `${f}:${i + 1}`, line })))
      .filter(({ line }) => /getByRole\(\s*["']dialog["']\s*\)/.test(line))
      .map(({ at }) => at);
    expect(bare).toEqual([]);
  });
});

describe("#739-5 📑 便利スライドの生成は BarMenu（DropdownMenu）", () => {
  it("押すと Portal に role=menu が出て、Esc で閉じてフォーカスが入口に戻る", async () => {
    const host = await mount(<GenerateSlideMenu hasActiveSlide onInsert={noop} onRegenerateActive={noop} />);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    expect(menu()).toBeNull();
    await press(trigger);
    expect(menu()).not.toBeNull();
    expect(host.contains(menu())).toBe(false); // Portal
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await key(document.activeElement ?? menu()!, "Escape");
    await settle();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("名前・項目は不変: 入口の説明は buttonTitle・「挿入」は項目で、押すと選んだモードで onInsert を 1 回呼んで閉じる", async () => {
    const onInsert = vi.fn();
    const host = await mount(<GenerateSlideMenu hasActiveSlide onInsert={onInsert} onRegenerateActive={noop} />);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.getAttribute("title")).toBe(t("generateSlide.buttonTitle"));
    await press(trigger);
    await press([...menu()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === t("generateSlide.modeStatic"))!);
    expect(menu()).not.toBeNull(); // モードの切り替えは項目でない（押しても閉じない）
    const items = [...menu()!.querySelectorAll<HTMLElement>("[role=menuitem]")].map((x) => (x.textContent ?? "").trim());
    expect(items).toEqual([t("generateSlide.insert"), `♻️ ${t("generateSlide.regenerate")}`]);
    await press([...menu()!.querySelectorAll<HTMLElement>("[role=menuitem]")][0]);
    await settle();
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith("static");
    expect(menu()).toBeNull();
  });

  it("外側のクリックで閉じる・手製の document リスナーを持たない", async () => {
    const host = await mount(<GenerateSlideMenu hasActiveSlide onInsert={noop} onRegenerateActive={noop} />);
    await press(host.querySelector<HTMLButtonElement>("button")!);
    expect(menu()).not.toBeNull();
    await clickOn(document.body);
    await settle();
    expect(menu()).toBeNull();
    const src = readFileSync(resolve(__dirname, "../src/components/GenerateSlideMenu.tsx"), "utf8");
    expect(src).not.toMatch(/document\.addEventListener/);
  });
});
