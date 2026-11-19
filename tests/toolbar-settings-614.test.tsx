/**
 * toolbar-settings-614.test.tsx — #614: 上部バーを文書の操作だけにする＋アイコンの役割を決める。
 *
 *  1. 上部バーのボタンは ↶ ↷ ｜ ファイル 📝原稿 🎨マスター ｜ ✨AI ⚙ の順。
 *     言語（JA/EN）・テーマ（🌙☀◐）・ヘルプ（?）はバーに直接並べず、⚙ のメニューに入れる。
 *  2. ⚙ のメニューから、言語・テーマ・ヘルプ・AI 接続設定に届く。
 *  3. ✨ は AI の機能だけに使う（目次の生成・更新通知には使わない）。
 *  4. ＋ は「追加」だけ：マスターの取り込みは 📥、Re-make は 🔁（取り込み結果の帯と同じアイコン）。
 *     📝 は原稿だけ：ファイル → Markdown の書き出しは 📄。
 * 数の上限（ボタン ≤ 7）と記号の許可リスト（✨・＋）は tests/ux-budget.test.tsx に集約（#648・R8）。
 * DOM 環境は無いので、react-dom/server で描画して確かめる（先例 tests/master-menu.test.tsx）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import Toolbar from "../src/components/Toolbar";
import MasterPicker from "../src/components/MasterPicker";
import { SettingsPanel } from "../src/components/SettingsMenu";
import GenerateSlideMenu from "../src/components/GenerateSlideMenu";
import UpdateBanner from "../src/components/UpdateBanner";
import { MasterMenu } from "../src/components/MasterMenu";
import type { MasterEntry } from "../src/components/useMasterRegistry";

const noop = () => {};
const masters: MasterEntry[] = [{ id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true }];

// useTheme reads <html data-theme> — give the node environment the one attribute it reads.
beforeAll(() => {
  vi.stubGlobal("document", { documentElement: { getAttribute: () => "dark", setAttribute: noop } });
});
afterAll(() => {
  vi.unstubAllGlobals();
  void i18n.changeLanguage("ja");
});

/** The top bar exactly as App wires it (every optional entry present → the worst case). */
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
      master={<MasterPicker masters={masters} activeId="builtin-gijutsu" onSelect={noop} onImport={noop} onRemake={noop} onCreate={noop} />}
    />,
  );
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

describe("#614 上部バー: 文書の操作だけ", () => {
  it("ボタンは ↶ ↷ ファイル 📝原稿 🎨マスター ✨AI ⚙ の順（数の上限は ux-budget）", () => {
    const b = buttons(topBar());
    expect(b).toEqual(["↶", "↷", "ファイル▾", "📝 原稿", "🎨技術報告 スタンダード水色▾", "✨ AI", "⚙"]);
  });

  it("言語・テーマ・ヘルプはバーに直接並べない（⚙ のメニューへ）", () => {
    const b = buttons(topBar());
    for (const gone of ["JA", "EN", "🌙", "☀", "◐", "?"]) expect(b).not.toContain(gone);
  });

  it("⚙ ボタンは名前（aria-label）で見つけられ、メニューを持つことを示す", () => {
    const tag = topBar().match(/<button[^>]*data-testid="settings-button"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('aria-label="設定"');
    expect(tag).toContain('aria-haspopup="true"');
  });

  it("英語表示では原稿ボタンは「📝 Draft」", async () => {
    await i18n.changeLanguage("en");
    try {
      expect(buttons(topBar())).toContain("📝 Draft");
    } finally {
      await i18n.changeLanguage("ja");
    }
  });
});

describe("#614 ⚙ のメニュー: 言語・テーマ・ヘルプ・AI 接続設定", () => {
  const panel = (p: Partial<Parameters<typeof SettingsPanel>[0]> = {}) =>
    renderToStaticMarkup(<SettingsPanel onClose={noop} onHelp={noop} onAiSettings={noop} {...p} />);

  it("言語（JA / EN）とテーマ（Dark / Light / Modern）を変えられる", () => {
    const html = panel();
    const b = buttons(html);
    expect(b).toEqual(expect.arrayContaining(["JA", "EN", "🌙", "☀", "◐"]));
    expect(html).toContain('title="Light"');
    expect(html).toContain('title="Modern（Slate）"');
    expect(html).toContain("言語");
    expect(html).toContain("配色");
  });

  it("ヘルプ（ドキュメント）と AI 接続設定への入口がある", () => {
    const b = buttons(panel());
    expect(b).toContain("? ヘルプ（ドキュメント）");
    expect(b).toContain("✨ AI 接続設定…"); // #653: 呼び名は aiSettings.title の 1 キー／#669: ダイアログを開く印「…」は menu.opensDialog が足す
  });

  it("入口が渡されないときは、その項目を出さない", () => {
    const b = buttons(panel({ onHelp: undefined, onAiSettings: undefined }));
    expect(b.some((x) => x.includes("ヘルプ"))).toBe(false);
    expect(b.some((x) => x.includes("AI 接続設定"))).toBe(false);
  });
});

describe("#614 ✨ は AI の機能だけ", () => {
  it("目次の生成ボタンは ✨ でなく 📑", () => {
    const html = renderToStaticMarkup(<GenerateSlideMenu hasActiveSlide onInsert={noop} onRegenerateActive={noop} />);
    expect(html).not.toContain("✨");
    expect(buttons(html)).toEqual(["📑"]);
  });

  it("更新通知は ✨ でなく 🔔", () => {
    const html = renderToStaticMarkup(<UpdateBanner latestVersion="9.9.9" onDismiss={noop} />);
    expect(html).not.toContain("✨");
    expect(html).toContain("🔔");
  });
});

describe("#614 ＋ は追加だけ・📝 は原稿だけ", () => {
  const html = renderToStaticMarkup(
    <MasterMenu masters={masters} activeId="builtin-gijutsu" onSelect={noop} onClose={noop} onImport={noop} onRemake={noop} onCreate={noop} />,
  );
  const b = buttons(html);

  it("マスターの取り込みは 📥・Re-make は 🔁（＋ が新規作成だけなのは ux-budget）", () => {
    expect(b.find((x) => x.includes("マスターを取り込む"))?.startsWith("📥")).toBe(true);
    expect(b.find((x) => x.includes("Re-make"))?.startsWith("🔁")).toBe(true);
  });

  it("ファイル → Markdown の書き出しは 📄（📝 は原稿ボタンだけ）", () => {
    const src = readFileSync(resolve(__dirname, "../src/components/Toolbar.tsx"), "utf8");
    expect(src).toContain("📄 Markdown");
    expect(src).not.toContain("📝 Markdown");
  });
});
