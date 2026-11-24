// @vitest-environment jsdom
/**
 * ux-findings-713-dom.test.tsx — #713-3 を実際の操作で確かめる（静的描画では「畳んだ状態」を作れないため）。
 * 選択中に指示欄を畳み、そのあと選択が外れたとき、無い指示欄の話（「指示欄はたたまれています」）をせず、
 * 未選択の案内を出す。選択し直すと畳んだ状態に戻る（利用者の操作は捨てない）。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "../src/i18n";
import ja from "../src/i18n/locales/ja.json";
import AiPanel from "../src/components/AiPanel";
import type { AiGeneration } from "../src/components/useAiGeneration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => {};
const ai = {
  connection: { ok: true, needsUserAction: false, tone: "ok", label: "gpt-4o を使用", hint: "" },
  tasks: [], candidates: [], result: "", error: "", notice: "", generating: false, bestOfRunning: false, bestOfN: 1,
  canGenerate: () => true, generate: noop, generateBest: noop, retry: noop, reset: noop, cancel: noop, cancelTask: noop, clearTasks: noop,
} as unknown as AiGeneration;
const panel = (currentSlideMd?: string): ReactElement => (
  <AiPanel onClose={noop} ai={ai} onApplySlide={noop} onOpenDraft={noop} currentSlideMd={currentSlideMd} activeSlideNum={1} />
);

beforeAll(async () => {
  await i18n.changeLanguage("ja");
});
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("#713-3 選択中に畳んだあと選択が外れる", () => {
  it("「指示欄はたたまれています」も ▸ も出さず、未選択の案内を出す。選択し直すと畳んだまま", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(panel("# タイトル")));
    const fold = document.querySelector<HTMLButtonElement>(`button[title="${ja.aiPanel.collapsePrompt}"]`)!;
    await act(async () => fold.click());
    expect(document.body.textContent).toContain(ja.aiPanel.promptCollapsedEcho); // 選択中: 指示欄は畳まれている

    await act(async () => root!.render(panel(undefined)));
    expect(document.body.textContent).not.toContain(ja.aiPanel.promptCollapsedEcho);
    expect(document.querySelector(`button[title="${ja.aiPanel.expandPrompt}"]`)).toBeNull();
    expect(document.querySelector("[data-testid=ai-deck-guidance]")).not.toBeNull();

    await act(async () => root!.render(panel("# タイトル")));
    expect(document.querySelector(`button[title="${ja.aiPanel.expandPrompt}"]`)).not.toBeNull();
  });
});
