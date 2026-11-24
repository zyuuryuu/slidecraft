/**
 * ux-findings-713.test.tsx — #713: 第 4 バッチのヒューリスティック評価で出た重大度 1 の所見 7 件。
 *
 *  1. 協働ロック（と テンプレート調整中）の理由文は 1 つの辞書キー。📝 原稿入力ボタンの説明（BarTip）と
 *     AI ドックの案内が同じ文を出す。調整中（busy）もボタンが理由を出す（Nielsen 4／ISO 9241-110 5.3）。
 *  2. スライド未選択のとき、「編集対象: スライドを選択してください」を出さない（隣の案内と重複・Nielsen 8）。
 *  3. スライド未選択のとき、指示欄の折りたたみ（▾／▸・「指示欄はたたまれています」）を出さない（Nielsen 1）。
 *  4. ダイアログを開く項目の「…」は包みキー menu.opensDialog だけが付ける（辞書値に焼き込まない・Nielsen 4）。
 *  5. 畳んだ記憶は「利用者の操作が要る（needsUserAction）とき」に畳んだ場合だけ残す。API キー未設定のヒントは
 *     「⚙ AI 接続設定で…」（畳まれた「下の設定」を指さない・Nielsen 3／1）。
 *  6. 上部バーのファイルのボタン名は「開く・保存・書き出し」（en「Open · Save · Export」）。ユーザ裁定（#713 コメント）。
 *  7. 🎨 テンプレートのボタンの前置きは、切れるときに省略記号（truncate）を出し、丸ごと入らない狭い窓（860px 未満）
 *     では出さない（Nielsen 8）。寸法は e2e（tests/e2e/topbar-width-713.spec.ts）で測る。
 * DOM 環境は無いので react-dom/server で描画して確かめる（先例 tests/ai-dock-deck-guidance-690.test.tsx）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import AiPanel from "../src/components/AiPanel";
import Toolbar from "../src/components/Toolbar";
import MasterPicker from "../src/components/MasterPicker";
import { MasterMenu } from "../src/components/MasterMenu";
import { DropdownMenu } from "../src/components/ui/dropdown-menu";
import { computeConnection } from "../src/components/ai-generation-types";
import { initialSettingsOpen, rememberFold } from "../src/components/ai-settings-fold";
import type { AiGeneration } from "../src/components/useAiGeneration";
import type { MasterEntry } from "../src/components/useMasterRegistry";

const noop = () => {};
const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const masters: MasterEntry[] = [{ id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true }];

// AiPanel reads its persisted height from localStorage; node has none. useTheme reads <html data-theme>.
beforeAll(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: noop, removeItem: noop });
  vi.stubGlobal("document", { documentElement: { getAttribute: () => "dark", setAttribute: noop } });
});
afterAll(() => {
  vi.unstubAllGlobals();
  void i18n.changeLanguage("ja");
});

function fakeAi(): AiGeneration {
  return {
    connection: { ok: true, needsUserAction: false, tone: "ok", label: "gpt-4o を使用", hint: "" },
    tasks: [], candidates: [], result: "", error: "", notice: "", generating: false, bestOfRunning: false, bestOfN: 1,
    canGenerate: () => true, generate: noop, generateBest: noop, retry: noop, reset: noop, cancel: noop, cancelTask: noop, clearTasks: noop,
  } as unknown as AiGeneration;
}
type PanelProps = Partial<Parameters<typeof AiPanel>[0]>;
const panel = (p: PanelProps = {}) =>
  renderToStaticMarkup(<AiPanel onClose={noop} ai={fakeAi()} onApplySlide={noop} onOpenDraft={noop} {...p} />);
const guidance = (html: string) => text(html.match(/<div[^>]*data-testid="ai-deck-guidance"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "");

type BarProps = Partial<Parameters<typeof Toolbar>[0]>;
const topBar = (p: BarProps = {}) =>
  renderToStaticMarkup(
    <Toolbar onSave={noop} onGenerate={noop} onExportHtml={noop} onSaveProject={noop} onOpenProject={noop} onAiAssist={noop}
      generating={false} hasSpec onUndo={noop} onRedo={noop} canUndo canRedo onHelp={noop} onAiSettings={noop} onDraft={noop}
      master={<MasterPicker masters={masters} activeId="builtin-gijutsu" onSelect={noop} onImport={noop} />} {...p} />,
  );
/** BarTip の説明要素（hidden span）のうち、📝 原稿入力ボタンに付いたもの。 */
const draftTip = (html: string) => {
  const m = html.match(new RegExp(`<button[^>]*aria-describedby="([^"]+)"[^>]*>${ja.toolbar.draft}</button>`));
  return m ? text(html.match(new RegExp(`<span id="${m[1]}" hidden="">([\\s\\S]*?)</span>`))?.[1] ?? "") : null;
};
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]).trim());

describe("#713-1 原稿が開けない理由は 1 つの辞書キー（ボタンの説明とドックの案内が同じ文）", () => {
  for (const gate of ["locked", "busy"] as const) {
    const key = gate === "locked" ? "app.draftGateLocked" : "app.draftGateBusy";
    it(`${gate}: 📝 原稿入力の説明 ＝ ドックの案内の理由 ＝ ${key}`, () => {
      const reason = t(key);
      expect(reason).not.toBe(key); // 辞書にある
      expect(draftTip(topBar({ draftGate: gate }))).toBe(reason);
      expect(guidance(panel({ currentSlideMd: undefined, draftGate: gate }))).toContain(reason);
    });
  }

  it("旧キー（app.draftLockedTitle・aiPanel.deckGuidanceLocked／Busy）は ja／en の辞書に残らない", () => {
    for (const d of [ja, en] as const) {
      expect("draftLockedTitle" in d.app).toBe(false);
      expect("deckGuidanceLocked" in d.aiPanel).toBe(false);
      expect("deckGuidanceBusy" in d.aiPanel).toBe(false);
    }
  });

  it("開けるときは用途の説明のまま", () => {
    expect(draftTip(topBar())).toBe(t("app.draftButtonTitle"));
  });
});

describe("#713-2・3 スライド未選択: 案内は 1 つだけ・折りたたみは出さない", () => {
  it("「編集対象:」「スライドを選択してください」を出さず、案内（スライドを選ぶと…）だけを出す", () => {
    const html = panel({ currentSlideMd: undefined });
    expect(text(html)).not.toContain(ja.aiPanel.editTargetLabel);
    expect("selectSlidePrompt" in ja.aiPanel).toBe(false);
    expect("selectSlidePrompt" in en.aiPanel).toBe(false);
    expect(guidance(html)).toContain(ja.aiPanel.deckGuidance);
  });

  it("指示欄の折りたたみ（▾／▸ のボタン・「たたまれています」）を出さない", () => {
    const html = panel({ currentSlideMd: undefined });
    expect(html).not.toContain(`title="${ja.aiPanel.collapsePrompt}"`);
    expect(html).not.toContain(`title="${ja.aiPanel.expandPrompt}"`);
    expect(buttons(html).filter((b) => b === "▾" || b === "▸")).toEqual([]); // ⚙ の Popover の aria-expanded は別物
  });

  it("選択中は今までどおり「編集対象: スライド N」と折りたたみのボタンが出る", () => {
    const html = panel({ currentSlideMd: "# タイトル", activeSlideNum: 2 });
    expect(text(html)).toContain(ja.aiPanel.editTargetLabel);
    expect(text(html)).toContain(t("aiPanel.slideScope", { num: 2 }));
    expect(html).toContain(`title="${ja.aiPanel.collapsePrompt}"`);
  });
});

describe("#713-4 「…」は包みキー menu.opensDialog だけが付ける", () => {
  const KEYS = ["createLabel", "adjustLabel", "augmentLabel"] as const;
  it("テンプレートのメニューの辞書値（作成・調整・強化）に「…」を焼き込まない（ja／en）", () => {
    for (const d of [ja, en] as const) for (const k of KEYS) expect(d.masterPicker[k], k).not.toMatch(/…$/);
  });

  it("メニューの項目は menu.opensDialog で包んで「…」を出す", () => {
    const b = buttons(renderToStaticMarkup(
      <DropdownMenu>
        <MasterMenu masters={masters} activeId="builtin-gijutsu" onSelect={noop} onAdjust={noop} onCreate={noop} />
      </DropdownMenu>,
    ));
    expect(b).toContain(`🔤${t("menu.opensDialog", { title: t("masterPicker.adjustLabel") })}`);
    expect(b).toContain(`＋${t("menu.opensDialog", { title: t("masterPicker.createLabel") })}`);
    expect(b.some((x) => x.endsWith("……"))).toBe(false);
  });

  it("MasterMenu は 3 項目のラベルを menu.opensDialog 経由で描く", () => {
    const s = readFileSync(resolve(__dirname, "../src/components/MasterMenu.tsx"), "utf8");
    expect(s.match(/menu\.opensDialog/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("#713-5 畳んだ記憶の条件とヒント文", () => {
  it("記憶するのは needsUserAction のときに畳んだ場合だけ（開く操作・問題なしで畳んだ操作は記憶を消す）", () => {
    expect(rememberFold(false, { needsUserAction: true })).toBe(true);
    expect(rememberFold(false, { needsUserAction: false })).toBe(false);
    expect(rememberFold(true, { needsUserAction: true })).toBe(false);
    expect(rememberFold(true, { needsUserAction: false })).toBe(false);
  });

  it("設定を済ませてから畳んだ利用者は、再び壊れたとき開いた時点で展開される", () => {
    const folded = rememberFold(false, { needsUserAction: false }); // 使える状態で畳む
    expect(initialSettingsOpen({ needsUserAction: true }, folded)).toBe(true); // 後でキーが失効した
  });

  it("LlmAssist は畳んだ記憶を rememberFold で決める（自前で条件を書かない・needsUserAction は読むだけ）", () => {
    const s = readFileSync(resolve(__dirname, "../src/components/LlmAssist.tsx"), "utf8");
    expect(s).toMatch(/saveSettingsFolded\(rememberFold\(/);
    expect(s).not.toMatch(/needsUserAction\s*[:=](?!=)/);
  });

  it("API キー未設定のヒントは「⚙ AI 接続設定」を指す（「下の設定」と言わない）", async () => {
    const conn = () => computeConnection({
      provider: "claude", preset: { native: true, keyRequired: true }, cfg: { baseURL: "", model: "claude-opus-4-8", apiKey: "" },
      builtinStatus: { kind: "idle" }, weightsPresent: null, builtinModel: null, modelsLoading: false, modelsError: null, models: [],
    });
    expect(conn().hint).toContain(`⚙ ${t("aiSettings.title")}`);
    expect(conn().hint).not.toContain("下の設定");
    await i18n.changeLanguage("en");
    try {
      expect(conn().hint).toContain(`⚙ ${t("aiSettings.title")}`);
      expect(conn().hint).not.toMatch(/below/i);
    } finally {
      await i18n.changeLanguage("ja");
    }
  });
});

describe("#713-6 ファイルのボタン名（ユーザ裁定）", () => {
  it("ja「開く・保存・書き出し」／en「Open · Save · Export」", async () => {
    expect(ja.toolbar.file).toBe("開く・保存・書き出し");
    expect(en.toolbar.file).toBe("Open · Save · Export");
    expect(buttons(topBar())).toContain("開く・保存・書き出し▾");
  });
});

describe("#713-7 テンプレートのボタンの前置き", () => {
  it("前置きは省略記号付きで切れ（truncate）、860px 未満では出さない", () => {
    const cls = topBar().match(new RegExp(`<span class="([^"]*)">${ja.masterPicker.buttonPrefix}</span>`))?.[1] ?? "";
    expect(cls).toContain("truncate");
    expect(cls).toContain("max-[860px]:hidden");
  });

  it("上部バーのボタンの包み（BarTip）は縮まない。縮むのは 🎨 だけ（狭い窓で隣のボタンに重ならない）", () => {
    const wraps = [...topBar().matchAll(/<span class="(inline-flex[^"]*)"[^>]*>\s*<button[^>]*>([\s\S]*?)<\/button>/g)]
      .map((m) => ({ cls: m[1], label: text(m[2]).trim() }));
    expect(wraps.length).toBe(6); // ファイルは説明なし（BarTip で包まない）
    for (const w of wraps) expect(w.cls, w.label).toContain(w.label.startsWith("🎨") ? "min-w-0" : "shrink-0");
  });
});
