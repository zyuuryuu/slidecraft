/**
 * ux-budget-dom.ts — UX 予算のメニューを「実際に開いた状態」で数える道具（#724 段 1 PR-A）。
 *
 * 以前は react-dom/server で全部の開閉状態を「開」にして描き（forceOpen）、HTML の入れ子で数えていた。
 * shadcn/ui（Base UI）のメニューは開いたときだけ、しかも Portal（document.body の直下）に描くので、その方式では
 * 数えられない。ここは jsdom に描き、メニューの入口（`aria-haspopup` を持つボタン）を実際に押して開き、
 * **document.body 全体**から数える。Portal に描かれても、入れ子に描かれても同じ結果になる。
 *
 *  - openPaths(node): 入口を押す経路を全部たどり、各経路で開いた状態の HTML とボタンの深さを返す。
 *  - openDepth(node): ボタンに届くまでに押す入口の数＋1 の最大値（上部バーのボタン＝1・⚙ の中＝2）。
 *    probes の menuDepth（入れ子で数える）と同じ量。両者の一致は ux-budget.test.tsx で確かめる（R8）。
 *  - openedGroups(node): 上部バーの入口を 1 つずつ開き、そのときの document.body を probes の groupItems で数える。
 *
 * 経路ごとに描き直す（開いたメニューを閉じる操作に依らない＝手製でも Base UI でも同じ）。入口を開く操作は
 * `press`（既定はクリック）。Base UI の Menu が pointerdown で開くなら PR-B でここだけ直す。
 */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { groupItems } from "./ux-budget-probes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** メニューの入口＝`aria-haspopup` を持つ押せるボタン（手製の ⚙・ファイル・🎨、Base UI の Menu.Trigger 等）。 */
const triggers = (): HTMLButtonElement[] =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]")].filter(
    (b) => !b.disabled && b.getAttribute("aria-haspopup") !== "false",
  );
const allButtons = (): HTMLButtonElement[] => [...document.body.querySelectorAll<HTMLButtonElement>("button")];
const label = (b: Element) => (b.textContent ?? "").trim();

export type Press = (el: HTMLElement) => void;
const click: Press = (el) => el.click();

/** node を document.body に描き、入口を path の順に押す（各段の番号は、その時点の triggers() の並び）。 */
async function mountAndOpen(node: ReactNode, path: number[], press: Press) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  let before: HTMLButtonElement[] = allButtons();
  for (const i of path) {
    before = allButtons();
    const t = triggers()[i];
    if (!t) throw new Error(`trigger #${i} not found on path ${path.join(">")}`);
    await act(async () => press(t));
  }
  return {
    before,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
      document.body.innerHTML = ""; // Portal に描かれた残りも消す
    },
  };
}

export interface OpenedPath {
  /** 押した入口のラベル（上部バーから順に）。 */
  path: string[];
  /** その状態の document.body。 */
  html: string;
  /** その経路で新たに現れたボタン（深さ＝path.length + 1）。 */
  revealed: string[];
}

/** 入口を押す経路を全部たどる（深さ優先・上部バーの並び順）。経路ごとに描き直す。 */
export async function openPaths(node: ReactNode, press: Press = click): Promise<OpenedPath[]> {
  const out: OpenedPath[] = [];
  const visit = async (path: number[], labels: string[]) => {
    const m = await mountAndOpen(node, path, press);
    const prev = new Set(path.length ? m.before : []);
    const revealed = allButtons().filter((b) => !prev.has(b));
    const html = document.body.innerHTML;
    // 今回の経路で現れた入口だけを、次に押す候補にする（番号は今の triggers() の並び）。
    const next = triggers().map((t, i) => ({ t, i })).filter(({ t }) => revealed.includes(t));
    const nextLabels = next.map(({ t }) => label(t));
    out.push({ path: labels, html, revealed: revealed.map(label) });
    await m.unmount();
    for (let k = 0; k < next.length; k++) await visit([...path, next[k].i], [...labels, nextLabels[k]]);
  };
  await visit([], []);
  return out;
}

/** ボタンに届くまでの段数の最大値と、その段のボタン（probes の menuDepth と同じ形）。 */
export async function openDepth(node: ReactNode, press: Press = click): Promise<{ depth: number; deepest: string[] }> {
  const paths = await openPaths(node, press);
  const depth = Math.max(0, ...paths.filter((p) => p.revealed.length).map((p) => p.path.length + 1));
  const deepest = paths.filter((p) => p.path.length + 1 === depth).flatMap((p) => p.revealed);
  return { depth, deepest };
}

/** 上部バーの入口を 1 つずつ開いた状態の、メニューの区画（role="group"）。並びは入口の並び順。 */
export async function openedGroups(node: ReactNode, press: Press = click) {
  const paths = await openPaths(node, press);
  return paths.filter((p) => p.path.length === 1).flatMap((p) => groupItems(p.html));
}
