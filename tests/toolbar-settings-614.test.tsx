/**
 * toolbar-settings-614.test.tsx — #614: 上部バーを文書の操作だけにする＋アイコンの役割を決める。
 *
 *  1. 上部バーに常に見えるボタンは 7 個以下（↶ ↷ ｜ ファイル 📝原稿 🎨マスター ｜ ✨AI ⚙）。
 *     言語（JA/EN）・テーマ（🌙☀◐）・ヘルプ（?）はバーに直接並べず、⚙ のメニューに入れる。
 *  2. ⚙ のメニューから、言語・テーマ・ヘルプ・AI の接続設定に届く。
 *  3. ✨ は AI の機能だけに使う（目次の生成・更新通知には使わない）。使用箇所は許可リストで固定し、
 *     AI でない機能に ✨ が戻ってきたら落ちる。
 *  4. ＋ は「追加」だけ：マスターの取り込みは 📥、Re-make は 🔁（取り込み結果の帯と同じアイコン）。
 *     📝 は原稿だけ：ファイル → Markdown の書き出しは 📄。
 * DOM 環境は無いので、react-dom/server で描画して確かめる（先例 tests/master-menu.test.tsx）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
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
  it("常に見えるボタンは 7 個以下（↶ ↷ ファイル 📝原稿 🎨マスター ✨AI ⚙）", () => {
    const b = buttons(topBar());
    expect(b.length).toBeLessThanOrEqual(7);
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

describe("#614 ⚙ のメニュー: 言語・テーマ・ヘルプ・AI の接続設定", () => {
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

  it("ヘルプ（ドキュメント）と AI の接続設定への入口がある", () => {
    const b = buttons(panel());
    expect(b).toContain("? ヘルプ（ドキュメント）");
    expect(b).toContain("✨ AI の接続設定…");
  });

  it("入口が渡されないときは、その項目を出さない", () => {
    const b = buttons(panel({ onHelp: undefined, onAiSettings: undefined }));
    expect(b.some((x) => x.includes("ヘルプ"))).toBe(false);
    expect(b.some((x) => x.includes("AI の接続設定"))).toBe(false);
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

  // 使用箇所の許可リスト。AI の機能（AI ドック・✨直す・AI で生成・テンプレ作成の AI 欄）だけ。
  // ここに足す変更は「その機能は AI か」をレビューで問う（AI でない機能に ✨ を戻さない）。
  const SRC = resolve(__dirname, "../src");
  const ALLOWED_SRC = new Set(["components/AiPanel.tsx", "components/SettingsMenu.tsx"]);
  const ALLOWED_KEYS = new Set([
    "initModal.generateAi",
    "llmAssist.title",
    "reviewBar.aiFix",
    "templateCreator.aiIntro",
    "templateCreator.aiProposeTitleNotReady",
    "toolbar.aiCollabLabel",
    "toolbar.aiLabel",
  ]);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  };
  // A comment line (// …, * …, /* …, {/* …) documents ✨, it does not render it.
  const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line) || /^\s*[^"'`]*\/\/.*✨/.test(line);

  it("src の画面コードで ✨ を描くのは許可リストのファイルだけ", () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (line.includes("✨") && !isComment(line) && !ALLOWED_SRC.has(rel)) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("辞書（ja / en）で ✨ を含むのは AI の機能のキーだけ", () => {
    for (const lang of ["ja", "en"]) {
      const dict = JSON.parse(readFileSync(join(SRC, `i18n/locales/${lang}.json`), "utf8"));
      const found: string[] = [];
      const visit = (o: unknown, path: string[]) => {
        if (typeof o === "string") { if (o.includes("✨")) found.push(path.join(".")); return; }
        if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) visit(v, [...path, k]);
      };
      visit(dict, []);
      expect(found.filter((k) => !ALLOWED_KEYS.has(k))).toEqual([]);
    }
  });
});

describe("#614 ＋ は追加だけ・📝 は原稿だけ", () => {
  const html = renderToStaticMarkup(
    <MasterMenu masters={masters} activeId="builtin-gijutsu" onSelect={noop} onClose={noop} onImport={noop} onRemake={noop} onCreate={noop} />,
  );
  const b = buttons(html);

  it("マスターの取り込みは 📥・Re-make は 🔁（＋ は新規作成だけ）", () => {
    expect(b.find((x) => x.includes("マスターを取り込む"))?.startsWith("📥")).toBe(true);
    expect(b.find((x) => x.includes("Re-make"))?.startsWith("🔁")).toBe(true);
    expect(b.filter((x) => x.startsWith("＋")).map((x) => x.includes("テンプレを作成"))).toEqual([true]);
  });

  it("ファイル → Markdown の書き出しは 📄（📝 は原稿ボタンだけ）", () => {
    const src = readFileSync(resolve(__dirname, "../src/components/Toolbar.tsx"), "utf8");
    expect(src).toContain("📄 Markdown");
    expect(src).not.toContain("📝 Markdown");
  });
});
