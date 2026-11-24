// @vitest-environment jsdom
/**
 * toolbar-overlays-724.test.tsx — #724 段 1 PR-B: 上部バーのメニュー・AI 接続設定・2 つのダイアログを shadcn/ui
 * （Base UI）の DropdownMenu／Popover／Dialog に置き換える。部品が担う挙動を、置き換えた画面で確かめる。
 *
 *  1. メニュー（保存・書き出し／🎨 テンプレート／⚙）: 入口を押すと、上部バーの外（Portal）に role="menu" が出る。
 *     区画（role="group"＋aria-label）と項目の数は置き換え前と同じ（区画名と数を固定）。項目は role="menuitem"。
 *  2. Esc で閉じ、フォーカスが入口に戻る。外側のクリックで閉じる。項目を押すとハンドラを 1 回呼んで閉じる。
 *     項目でない行（言語の切り替え）を押してもメニューは閉じない。
 *  3. AI 接続設定（AI ドックの状態ピル）: 押すと Portal に設定が出て、Esc・外側のクリックで閉じる。
 *  4. ダイアログ（原稿入力・テンプレートを作成）: role="dialog" が Portal に出て、外側（アプリ本体）は aria-hidden
 *     （Base UI は aria-modal でなく外側を隠す方式）。開いたときフォーカスがダイアログの中にある（focus trap の入口）。
 *     原稿入力はダイアログ自体にフォーカスを置く（最初の操作＝🎨 のメニューに置くと Tooltip が開き、最初の Esc を取るため）。Esc と閉じるボタンでキャンセル、背景のクリックでは閉じない
 *     （原稿入力のキャンセルは開く前の内容に戻す＝誤クリックで原稿を失わないため。以前と同じ挙動）。
 * Tab で外に出ない（focus trap の循環）ことは実ブラウザで確かめる（tests/e2e/overlays-724.spec.ts）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "../src/i18n";
import Toolbar from "../src/components/Toolbar";
import MasterPicker from "../src/components/MasterPicker";
import AiPanel from "../src/components/AiPanel";
import InitializeModal from "../src/components/InitializeModal";
import TemplateCreator from "../src/components/TemplateCreator";
import type { MasterEntry } from "../src/components/useMasterRegistry";
import type { AiGeneration } from "../src/components/useAiGeneration";

// Monaco and the slide renderer are not what this test is about (and do not run in jsdom).
vi.mock("../src/components/Editor", () => ({ default: () => <textarea data-testid="editor-stub" /> }));
vi.mock("../src/components/SlidePreview", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  default: () => <div data-testid="preview-stub" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const t = (k: string) => i18n.t(k) as string;
const masters: MasterEntry[] = [
  { id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true },
  { id: "m1", name: "会社", builtin: false },
];

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
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** Base UI schedules the initial focus with requestAnimationFrame (floating-ui-react/utils/enqueueFocus.js), which
 *  settle()'s setTimeout(0) does not wait for — under load the check then runs before the focus lands (flake). Poll. */
const focusLands = (check: () => void) => act(async () => { await vi.waitFor(check); });

const bar = (p: Partial<Parameters<typeof Toolbar>[0]> = {}) => (
  <Toolbar
    onSave={noop} onGenerate={noop} onExportHtml={noop} onSaveProject={noop} onOpenProject={noop} onAiAssist={noop}
    generating={false} hasSpec onUndo={noop} onRedo={noop} canUndo canRedo onHelp={noop} onAiSettings={noop} onDraft={noop}
    master={<MasterPicker masters={masters} activeId="builtin-gijutsu" onSelect={noop} onImport={noop} onRemake={noop}
      onAdjust={noop} onShowInfo={noop} onCreate={noop} onRemove={noop} />}
    {...p}
  />
);
const topBar = () => document.querySelector<HTMLElement>("[data-testid=top-bar]")!;
function trigger(start: string): HTMLButtonElement {
  const b = [...topBar().querySelectorAll<HTMLButtonElement>("button")].find((x) => (x.textContent ?? "").trim().startsWith(start));
  if (!b) throw new Error(`no button ${start}`);
  return b;
}
const press = (el: HTMLElement) => act(async () => { el.click(); });
const key = (el: Element, k: string) =>
  act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
const outside = () =>
  act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
  });
const menu = () => document.querySelector<HTMLElement>("[role=menu]");
/** The open menu's sections: label + number of items (role="menuitem" directly or as the row of a list) + non-item rows. */
const sections = () =>
  [...menu()!.querySelectorAll<HTMLElement>("[role=group][aria-label]")]
    .filter((g) => ![...g.children].every((c) => c.hasAttribute("aria-pressed"))) // a segment row (toggle) is not a section
    .map((g) => ({ label: g.getAttribute("aria-label"), items: g.querySelectorAll("[role=menuitem]").length }));
const itemNamed = (start: string) =>
  [...menu()!.querySelectorAll<HTMLElement>("[role=menuitem]")].find((x) => (x.textContent ?? "").trim().startsWith(start))!;

describe("#724 PR-B 1: メニューは Portal に出て、区画と項目は置き換え前と同じ", () => {
  it("保存・書き出し: 開く・保存（2）／書き出す（PPTX・HTML・Markdown の 3＋遷移の行）", async () => {
    await mount(bar());
    expect(menu()).toBeNull(); // 閉じているときは描かない
    await press(trigger(t("toolbar.file")));
    expect(menu()).not.toBeNull();
    expect(topBar().contains(menu())).toBe(false); // Portal（上部バーの外）
    expect(sections()).toEqual([
      { label: t("toolbar.projectSection"), items: 2 },
      { label: t("toolbar.exportSection"), items: 3 },
    ]);
    expect(menu()!.querySelector(`[role=group][aria-label="${t("toolbar.transitionGroup")}"]`)).not.toBeNull(); // 遷移の行は残る
  });

  it("🎨 テンプレート: 選ぶ（2 件＋取り込んだものの 🗑）／取り込む（2）／加工する（2）／新規（1）", async () => {
    await mount(bar());
    await press(trigger("🎨"));
    expect(topBar().contains(menu())).toBe(false);
    expect(sections()).toEqual([
      { label: t("masterPicker.section.select"), items: 3 },
      { label: t("masterPicker.section.intake"), items: 2 },
      { label: t("masterPicker.section.modify"), items: 2 },
      { label: t("masterPicker.section.create"), items: 1 },
    ]);
  });

  it("⚙: 表示（言語・配色の行。項目でない）／AI・ヘルプ（2）", async () => {
    await mount(bar());
    await press(trigger("⚙"));
    expect(topBar().contains(menu())).toBe(false);
    expect(sections()).toEqual([
      { label: t("settings.displaySection"), items: 0 },
      { label: t("settings.aiHelpSection"), items: 2 },
    ]);
    expect(menu()!.querySelector(`[aria-label="${t("lang.aria")}"]`)).not.toBeNull();
    expect(menu()!.querySelector(`[aria-label="${t("themeToggle.groupLabel")}"]`)).not.toBeNull();
  });
});

describe("#724 PR-B 2: 閉じ方（Esc・外側のクリック・項目）", () => {
  it("Esc で閉じ、入口の aria-expanded が false に戻り、フォーカスが入口に戻る", async () => {
    await mount(bar());
    const gear = trigger("⚙");
    await press(gear);
    expect(gear.getAttribute("aria-expanded")).toBe("true");
    await key(document.activeElement ?? menu()!, "Escape");
    await settle();
    expect(menu()).toBeNull();
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(gear);
  });

  it("Esc で閉じて入口に戻ったフォーカスでは Tooltip を開かない（次の Esc を Tooltip が取らない）。離れて戻れば開く", async () => {
    await mount(bar());
    const gear = trigger("⚙");
    const tip = () => document.querySelector("[data-slot=tooltip-content]");
    await press(gear);
    await key(document.activeElement ?? menu()!, "Escape");
    await settle();
    expect(document.activeElement).toBe(gear);
    await act(async () => { gear.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    await settle();
    expect(tip()).toBeNull();
    // 道具の自己検査: 一度フォーカスが離れて戻れば、従来どおり開く
    const draftBtn = trigger(t("toolbar.draft"));
    await act(async () => { draftBtn.focus(); });
    await act(async () => { gear.focus(); gear.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    await settle();
    expect(tip()?.textContent).toContain(t("settings.buttonTitle"));
  });

  it("外側のクリックで閉じる（3 つのメニューとも）", async () => {
    await mount(bar());
    for (const start of [t("toolbar.file"), "🎨", "⚙"]) {
      await press(trigger(start));
      expect(menu(), start).not.toBeNull();
      await outside();
      await settle();
      expect(menu(), start).toBeNull();
    }
  });

  it("項目を押すとハンドラを 1 回呼んで閉じる（onClose の連鎖は無い）", async () => {
    const onSave = vi.fn();
    const onCreate = vi.fn();
    await mount(bar({ onSave, master: <MasterPicker masters={masters} activeId="builtin-gijutsu" onSelect={noop} onCreate={onCreate} /> }));
    await press(trigger(t("toolbar.file")));
    await press(itemNamed("📄 Markdown"));
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    await press(trigger("🎨"));
    await press(itemNamed("＋"));
    await settle();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("項目でない行（⚙ の言語の切り替え）を押してもメニューは閉じない", async () => {
    await mount(bar());
    await press(trigger("⚙"));
    try {
      await press([...menu()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "EN")!);
      expect(menu()).not.toBeNull();
    } finally {
      await i18n.changeLanguage("ja");
    }
  });

  it("押せない項目（文書が無いときの 📊 PPTX）は aria-disabled で、押してもハンドラを呼ばない", async () => {
    const onGenerate = vi.fn();
    await mount(bar({ hasSpec: false, onGenerate }));
    await press(trigger(t("toolbar.file")));
    const pptx = itemNamed("📊 PPTX");
    expect(pptx.getAttribute("aria-disabled")).toBe("true");
    await press(pptx);
    expect(onGenerate).not.toHaveBeenCalled();
  });
});

function fakeAi(): AiGeneration {
  const ai = {
    connection: { ok: true, needsUserAction: false, tone: "ok", label: "gpt-4o を使用", hint: "" },
    provider: "openai", preset: { native: true, keyRequired: true }, cfg: { baseURL: "", model: "gpt-4o", apiKey: "" },
    models: [], builtinStatus: { kind: "idle" }, localModelOnly: false, rememberKey: false,
    setProvider: noop, setField: noop, setRememberKey: noop, refreshModels: noop, setBestOfN: noop, setLocalModelOnly: noop,
    tasks: [], candidates: [], result: "", error: "", notice: "", generating: false, bestOfRunning: false, bestOfN: 1,
    canGenerate: () => true, generate: noop, generateBest: noop, retry: noop, reset: noop, cancel: noop, cancelTask: noop, clearTasks: noop,
  };
  return ai as unknown as AiGeneration;
}

describe("#724 PR-B 3: AI 接続設定（状態ピル → Popover）", () => {
  const popover = () => document.querySelector("[data-testid=ai-settings-popover]");
  const pill = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").includes("gpt-4o を使用"))!;

  it("ピルを押すと Portal に設定が出て、Esc で閉じる・外側のクリックで閉じる", async () => {
    await mount(<AiPanel onClose={noop} ai={fakeAi()} onApplySlide={noop} onOpenDraft={noop} />);
    expect(popover()).toBeNull();
    await press(pill());
    expect(popover()).not.toBeNull();
    expect(popover()!.textContent).toContain(t("aiSettings.title"));
    expect(pill().parentElement!.contains(popover())).toBe(false); // Portal
    await key(document.activeElement ?? popover()!, "Escape");
    await settle();
    expect(popover()).toBeNull();
    await press(pill());
    expect(popover()).not.toBeNull();
    await outside();
    await settle();
    expect(popover()).toBeNull();
  });

  // In Chromium a focused, closed <select> changes its value on ↓ (→ ai.setProvider): opening the settings must not
  // put the focus on the provider select, so a keyboard user's first arrow press cannot switch the provider.
  it("開いた直後のフォーカスは Popover 自体（role=dialog）にあり、プロバイダの <select> ではない", async () => {
    await mount(<AiPanel onClose={noop} ai={fakeAi()} onApplySlide={noop} onOpenDraft={noop} />);
    await press(pill());
    await settle();
    const p = popover() as HTMLElement;
    expect(p.getAttribute("role")).toBe("dialog");
    await focusLands(() => expect(document.activeElement).toBe(p));
    expect(document.activeElement!.tagName).not.toBe("SELECT");
  });

  it("⚙ →「AI 接続設定…」の要求（openSettingsTs）で開く", async () => {
    await mount(<AiPanel onClose={noop} ai={fakeAi()} onApplySlide={noop} onOpenDraft={noop} openSettingsTs={1} />);
    await settle();
    expect(popover()).not.toBeNull();
  });
});

describe("#724 PR-B 4: ダイアログ（原稿入力・テンプレートを作成）", () => {
  const dialog = () => document.querySelector<HTMLElement>("[role=dialog]");
  const backdrop = () => document.querySelector<HTMLElement>("[data-slot=dialog-overlay]");
  const draft = (onCancel = vi.fn()) => (
    <InitializeModal
      isOpen onCancel={onCancel} onConfirm={noop} mdText="# a" onMdChange={noop} onOpenFile={noop} onStructure={noop} onGenerateAI={noop}
      masters={masters} activeMasterId="builtin-gijutsu" onSelectMaster={noop} onImportMaster={noop} onRemakeMaster={noop}
      deck={null} templateData={null} parseError={null} activeSlide={0} onSlideClick={noop} warnIssues={[]} tipIssues={[]}
      onFixDeterministic={noop} onCursorLine={noop}
    />
  );

  it("原稿入力: Portal に role=dialog（名前あり）が出て、外側は隠れ、フォーカスはダイアログ自体にある", async () => {
    await mount(draft());
    await settle();
    const d = dialog()!;
    const host = document.body.firstElementChild!; // the mount host (the app)
    expect(d).not.toBeNull();
    expect(host.contains(d)).toBe(false); // Portal
    expect(host.getAttribute("aria-hidden")).toBe("true"); // the app behind is hidden from assistive tech while open
    expect(d.getAttribute("aria-label")).toBe(t("initModal.dialogLabel"));
    await focusLands(() => expect(document.activeElement).toBe(d));
    expect(backdrop()).not.toBeNull();
  });

  it("原稿入力: Esc・×・キャンセルで onCancel、背景のクリックでは呼ばない", async () => {
    const onCancel = vi.fn();
    await mount(draft(onCancel));
    await settle();
    await key(document.activeElement ?? dialog()!, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await press(dialog()!.querySelector<HTMLElement>(`[aria-label="${t("dialog.close")}"]`)!); // #739-3: × の名前は dialog.close
    expect(onCancel).toHaveBeenCalledTimes(2);
    await press([...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === t("initModal.cancel"))!);
    expect(onCancel).toHaveBeenCalledTimes(3);
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        backdrop()!.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
      }
    });
    await settle();
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(dialog()).not.toBeNull();
  });

  it("テンプレートを作成: role=dialog・フォーカスは中・Esc で onCancel・閉じるボタンに辞書の名前", async () => {
    const onCancel = vi.fn();
    await mount(<TemplateCreator isOpen onCancel={onCancel} onCreate={async () => {}} />);
    await settle();
    const d = dialog()!;
    expect(d.getAttribute("aria-label")).toBe(t("templateCreator.dialogLabel"));
    await focusLands(() => expect(d.contains(document.activeElement)).toBe(true));
    expect(d.querySelector(`[aria-label="${t("dialog.close")}"]`)).not.toBeNull();
    await key(document.activeElement ?? d, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
