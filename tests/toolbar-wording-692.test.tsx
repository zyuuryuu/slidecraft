/**
 * toolbar-wording-692.test.tsx — #692: 上部バーの 3 つのボタン（ファイル・📝 原稿・🎨 <テンプレ名>）を、押す前に
 * 用途が分かる名前にし、テンプレートの呼び名を「テンプレート」1 つに揃える（UX 原則 4「語は利用者の語で」）。
 *
 *  1. 上部バーのボタン名は辞書の新しい値：「保存・書き出し ▾」「📝 原稿入力」「🎨 テンプレート：<名前> ▾」。
 *  2. 保存・書き出しのメニューは、区画ごとに見える見出し（開く・保存／書き出す）を持ち、見出しは区画の名前と同じ。
 *  3. 辞書（ja）の値に「マスター」「スライドマスター」「テンプレ（テンプレートでない略称）」「Draft」が残っていない。
 *     辞書（en）の値に「master」が残っていない。
 * ボタンの数（≤ 7）・区画の数は tests/ux-budget.test.tsx が持つ（R8）。ここは語だけを見る。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n";
import Toolbar from "../src/components/Toolbar";
import MasterPicker from "../src/components/MasterPicker";
import type { MasterEntry } from "../src/components/useMasterRegistry";

// メニューを「開」で描くための切り替え（ux-budget.test.tsx と同じ手口）。
const force = vi.hoisted(() => ({ open: false }));
vi.mock("react", async (importOriginal) => {
  const R = await importOriginal<typeof import("react")>();
  const useState = ((init: unknown) => R.useState(force.open && init === false ? true : init)) as typeof R.useState;
  return { ...R, default: { ...R, useState }, useState };
});
const withAllOpen = <T,>(fn: () => T): T => {
  force.open = true;
  try { return fn(); } finally { force.open = false; }
};

const noop = () => {};
const masters: MasterEntry[] = [{ id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true }];

beforeAll(() => {
  vi.stubGlobal("document", { documentElement: { getAttribute: () => "dark", setAttribute: noop } });
});
afterAll(() => {
  vi.unstubAllGlobals();
  void i18n.changeLanguage("ja");
});

const topBar = () =>
  renderToStaticMarkup(
    <Toolbar
      onSave={noop}
      onGenerate={noop}
      onExportHtml={noop}
      onSaveProject={noop}
      onOpenProject={noop}
      onAiAssist={noop}
      generating={false}
      hasSpec
      onUndo={noop}
      onRedo={noop}
      canUndo
      canRedo
      onHelp={noop}
      onAiSettings={noop}
      onDraft={noop}
      master={<MasterPicker masters={masters} activeId="builtin-gijutsu" onSelect={noop} onImport={noop} />}
    />,
  );
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim());

describe("#692 上部バーのボタン名", () => {
  it("日本語: 保存・書き出し ▾ ／ 📝 原稿入力 ／ 🎨 テンプレート：<名前> ▾", () => {
    const b = buttons(topBar());
    expect(b).toContain("保存・書き出し▾");
    expect(b).toContain("📝 原稿入力");
    expect(b).toContain("🎨テンプレート：技術報告 スタンダード水色▾");
  });

  it("英語: Save & Export ▾ ／ 📝 Write draft ／ 🎨 Template:<name> ▾", async () => {
    await i18n.changeLanguage("en");
    try {
      const b = buttons(topBar());
      expect(b).toContain("Save & Export▾");
      expect(b).toContain("📝 Write draft");
      expect(b).toContain("🎨Template:技術報告 スタンダード水色▾");
    } finally {
      await i18n.changeLanguage("ja");
    }
  });

  it("テンプレートのボタン: 幅が足りないときは名前の側を先に省略する（名前の flex-shrink が前置きより大きい）", () => {
    const shrink = (cls: string) => Number(cls.match(/shrink-\[(\d+)\]/)?.[1] ?? (/\bshrink-0\b/.test(cls) ? 0 : 1));
    const cls = (text: string) => topBar().match(new RegExp(`<span class="([^"]*)">${text}</span>`))?.[1] ?? "";
    const prefix = cls("テンプレート：");
    const name = cls("技術報告 スタンダード水色");
    expect(name).toContain("truncate");
    expect(shrink(name)).toBeGreaterThan(shrink(prefix));
  });
});

describe("#692 保存・書き出しのメニューの見出し", () => {
  it("区画ごとに見える見出し（開く・保存／書き出す）があり、区画の名前（aria-label）と同じ", () => {
    const html = withAllOpen(topBar);
    for (const [label, text] of [["toolbar.projectSection", "開く・保存"], ["toolbar.exportSection", "書き出す"]] as const) {
      expect(i18n.t(label)).toBe(text);
      const group = html.match(new RegExp(`<div role="group" aria-label="${text}">([\\s\\S]*?)<button`))?.[1] ?? "";
      expect(group, label).toMatch(new RegExp(`>${text}</div>`));
    }
  });
});

describe("#692 呼び名の統一（辞書の値）", () => {
  const values = (lang: "ja" | "en"): string[] => {
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(readFileSync(resolve(__dirname, `../src/i18n/locales/${lang}.json`), "utf8")));
    return out;
  };

  it("ja: 「マスター」「スライドマスター」「テンプレ（略称）」「Draft」が残っていない", () => {
    const ja = values("ja");
    expect(ja.filter((s) => s.includes("マスター"))).toEqual([]);
    expect(ja.filter((s) => /テンプレ(?!ート)/.test(s))).toEqual([]);
    expect(ja.filter((s) => /\bDraft\b/.test(s))).toEqual([]);
  });

  it("en: 「master」が残っていない（呼び名は template）", () => {
    expect(values("en").filter((s) => /\bmasters?\b/i.test(s))).toEqual([]);
  });
});
