/**
 * toolbar-html-transition-650.test.tsx — #650: HTML 書き出しの遷移の選択を、ファイルのメニューの中（2 段目）に置く。
 *
 *  以前は ファイル ▾ → 🌐 HTML ▸（hover で開く横のメニュー）→ 遷移の種類 の 3 段だった（UX 予算のネスト ≤ 2 を超過）。
 *  今は ファイル ▾ の中に「🌐 HTML」1 項目と、その直下に遷移を選ぶ 1 行（4 つの切り替えボタン）を置く。
 *  ネスト ≤ 2 の検査そのものは tests/ux-budget.test.tsx（R8: 数値はそちらだけ）。ここは「機能を減らしていない」ことを見る：
 *   1. 4 種類の遷移（スライド・フェード・ズーム・プッシュ）を選べる。既定はスライド（押された状態で描かれる）。
 *   2. 選んだ遷移で書き出す（クリックの経路は e2e: tests/e2e/html-transition.spec.ts）。
 *   3. 遷移の切り替えボタンの名前に「HTML」を含めない（e2e は 🌐 HTML ボタンを /HTML/ で探す＝一意であること）。
 * DOM 環境は無いので、react-dom/server で描画して確かめる（先例 tests/toolbar-settings-614.test.tsx）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n";
import HtmlTransitionPicker from "../src/components/HtmlTransitionPicker";
import { HTML_TRANSITIONS } from "../src/components/html-transitions";
import Toolbar from "../src/components/Toolbar";

const noop = () => {};

// Toolbar のメニューは閉じた状態で始まるので、useState(false) を「開」で始めて描く（ux-budget と同じ手口）。
const force = vi.hoisted(() => ({ open: false }));
vi.mock("react", async (importOriginal) => {
  const R = await importOriginal<typeof import("react")>();
  const useState = ((init: unknown) => R.useState(force.open && init === false ? true : init)) as typeof R.useState;
  return { ...R, default: { ...R, useState }, useState };
});

beforeAll(() => {
  vi.stubGlobal("document", { documentElement: { getAttribute: () => "dark", setAttribute: noop } });
});
afterAll(() => {
  vi.unstubAllGlobals();
  void i18n.changeLanguage("ja");
});

/** `<button …>label</button>` → { label, pressed } */
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    label: m[2].replace(/<[^>]+>/g, "").trim(),
    pressed: /aria-pressed="true"/.test(m[1]),
    disabled: /\sdisabled=""/.test(m[1]),
  }));

describe("#650 HTML の遷移の選択（ファイルのメニューの中の 1 行）", () => {
  it("4 種類の遷移を、順にボタンとして描く（既定のスライドが押された状態）", () => {
    const b = buttons(renderToStaticMarkup(<HtmlTransitionPicker value="slide" onChange={noop} />));
    expect(b.map((x) => x.label)).toEqual(["スライド", "フェード", "ズーム", "プッシュ"]);
    expect(b.map((x) => x.pressed)).toEqual([true, false, false, false]);
  });

  it("選んだ遷移が押された状態になる", () => {
    const b = buttons(renderToStaticMarkup(<HtmlTransitionPicker value="zoom" onChange={noop} />));
    expect(b.map((x) => x.pressed)).toEqual([false, false, true, false]);
  });

  it("書き出せない（文書が無い）ときは切り替えボタンも押せない", () => {
    const b = buttons(renderToStaticMarkup(<HtmlTransitionPicker value="slide" onChange={noop} disabled />));
    expect(b.every((x) => x.disabled)).toBe(true);
  });

  it("選択肢は engine の Transition の 4 値と一致する（増減したらここで気づく）", () => {
    expect(HTML_TRANSITIONS.map((x) => x.v)).toEqual(["slide", "fade", "zoom", "push"]);
  });

  it("切り替えの区画には名前があり、ボタンの名前に HTML を含めない（🌐 HTML ボタンを一意に保つ）", () => {
    const html = renderToStaticMarkup(<HtmlTransitionPicker value="slide" onChange={noop} />);
    expect(html).toMatch(/role="group"[^>]*aria-label="HTML の遷移"/);
    for (const x of buttons(html)) expect(x.label).not.toMatch(/HTML/);
  });

  it("英語表示では Slide / Fade / Zoom / Push", async () => {
    await i18n.changeLanguage("en");
    try {
      const html = renderToStaticMarkup(<HtmlTransitionPicker value="slide" onChange={noop} />);
      expect(buttons(html).map((x) => x.label)).toEqual(["Slide", "Fade", "Zoom", "Push"]);
      expect(html).toContain('aria-label="HTML transition"');
    } finally {
      await i18n.changeLanguage("ja");
    }
  });
});

describe("#650 ファイルのメニューの並び", () => {
  it("🌐 HTML の直後に遷移の 1 行があり、横に開くメニュー（▸）は無い", () => {
    force.open = true;
    let html: string;
    try {
      html = renderToStaticMarkup(
        <Toolbar onSave={noop} onGenerate={noop} onExportHtml={noop} onSaveProject={noop} onOpenProject={noop} generating={false} hasSpec />,
      );
    } finally {
      force.open = false;
    }
    const labels = buttons(html).map((x) => x.label);
    const i = labels.findIndex((l) => l.startsWith("🌐 HTML"));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(labels.slice(i + 1, i + 5)).toEqual(["スライド", "フェード", "ズーム", "プッシュ"]);
    expect(labels[i + 5]).toBe("📄 Markdown.md");
    expect(html).not.toContain("▸");
  });
});
