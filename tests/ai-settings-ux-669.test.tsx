/**
 * ai-settings-ux-669.test.tsx — #669: PR #664（#653）のヒューリスティック評価の残所見（ux-principles.md §2・§5.2）。
 *
 *  1. 「AIで生成」ダイアログの接続設定を展開するのは「利用者の操作が要る」ときだけ。内蔵 AI（llamafile）の
 *     未起動は生成ボタンで自動起動するので操作は要らない。その信号（ConnectionStatus.needsUserAction）は
 *     computeConnection だけが決める（R8）。
 *  2. ⚙ メニューの「AI 接続設定」項目に、ダイアログを開く項目の印「…」を戻す。呼び名の辞書キーは
 *     aiSettings.title のまま（1 キー原則）で、「…」は包みキー menu.opensDialog が足す。
 *  3. 「畳んだ」を localStorage に記憶する（#236 と同じ単一フラグの流儀）。読めなくても動く。
 * DOM 環境は無いので react-dom/server で描画して確かめる（先例 tests/ai-settings-ux-653.test.tsx）。
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import LlmAssist from "../src/components/LlmAssist";
import { SettingsPanel } from "../src/components/SettingsMenu";
import { computeConnection, type ConnectionStatus } from "../src/components/ai-generation-types";
import {
  AI_SETTINGS_FOLDED_KEY, loadSettingsFolded, saveSettingsFolded, initialSettingsOpen,
} from "../src/components/ai-settings-fold";
import type { AiGeneration } from "../src/components/useAiGeneration";

const noop = () => {};
const SRC = resolve(__dirname, "../src");
const src = (p: string) => readFileSync(join(SRC, p), "utf8");

afterAll(() => {
  void i18n.changeLanguage("ja");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type ConnArgs = Parameters<typeof computeConnection>[0];
const builtin = (over: Partial<ConnArgs> = {}): ConnArgs => ({
  provider: "builtin",
  preset: { native: false, keyRequired: false },
  cfg: { baseURL: "", model: "granite", apiKey: "" },
  builtinStatus: { kind: "idle" },
  weightsPresent: true,
  builtinModel: null,
  modelsLoading: false,
  modelsError: null,
  models: [],
  ...over,
});
const openai = (over: Partial<ConnArgs> = {}): ConnArgs => ({
  provider: "openai",
  preset: { native: false, keyRequired: true },
  cfg: { baseURL: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "" },
  builtinStatus: { kind: "idle" },
  weightsPresent: null,
  builtinModel: null,
  modelsLoading: false,
  modelsError: null,
  models: ["gpt-4o"],
  ...over,
});

/** fakeAi の形は tests/ai-settings-ux-653.test.tsx と同じ。接続状態は本物の computeConnection から作る。 */
function fakeAi(connection: ConnectionStatus): AiGeneration {
  const ai = {
    provider: "openai", setProvider: noop,
    cfg: { apiKey: "", baseURL: "https://api.openai.com/v1", model: "" },
    preset: { native: false, keyRequired: true }, setField: noop,
    rememberKey: true, setRememberKey: noop,
    generating: false, result: "", setResult: noop, error: "", notice: "",
    canGenerate: () => false, generate: noop, cancel: noop,
    models: [], modelsError: "", refreshModels: noop, ollamaModels: null, switchToOllama: noop,
    connection,
    switchToBuiltin: noop, stopBuiltin: noop, builtinStatus: { kind: "idle" }, weightsPresent: null, builtinModel: null,
    localModelOnly: false, setLocalModelOnly: noop, localBlocked: false, bestOfN: 1, setBestOfN: noop,
  };
  return ai as unknown as AiGeneration;
}
const dialog = (ai: AiGeneration) =>
  renderToStaticMarkup(<LlmAssist isOpen onClose={noop} onImportResult={noop} ai={ai} />);
const expanded = (html: string) =>
  /<button[^>]*data-testid="llm-ai-settings-toggle"[^>]*aria-expanded="true"/.test(html);

/** A Map-backed localStorage stand-in (node 環境に localStorage は無い). */
function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(p) ? [p] : [];
  });
}

describe("#669-1 needsUserAction — 利用者の操作が要るかは computeConnection だけが決める", () => {
  it("内蔵 AI の未起動（重みあり／未確認）は自動起動で足りる → 操作は要らない", () => {
    expect(computeConnection(builtin()).needsUserAction).toBe(false);
    expect(computeConnection(builtin({ weightsPresent: null })).needsUserAction).toBe(false);
    expect(computeConnection(builtin()).ok).toBe(false); // まだ使える状態ではない（ok の意味は変えない）
  });

  it("進行中（ダウンロード・起動中・モデル一覧の取得中）は待てばよい → 操作は要らない", () => {
    expect(computeConnection(builtin({ builtinStatus: { kind: "downloading", pct: 10 } })).needsUserAction).toBe(false);
    expect(computeConnection(builtin({ builtinStatus: { kind: "starting" } })).needsUserAction).toBe(false);
    expect(computeConnection(openai({ cfg: { baseURL: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "sk" }, modelsLoading: true })).needsUserAction).toBe(false);
  });

  it("使える状態（ok）は操作が要らない", () => {
    const c = computeConnection(openai({ cfg: { baseURL: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "sk" } }));
    expect(c.ok).toBe(true);
    expect(c.needsUserAction).toBe(false);
  });

  it("利用者が直すしかない状態 → 操作が要る", () => {
    const cases: Array<[string, ConnArgs]> = [
      ["内蔵 AI の重みが未取得（⬇ でダウンロード）", builtin({ weightsPresent: false })],
      ["内蔵 AI の起動失敗", builtin({ builtinStatus: { kind: "error", message: "x" } })],
      ["内蔵 AI が応答しない", builtin({ cfg: { baseURL: "http://127.0.0.1:1", model: "granite", apiKey: "" }, modelsError: "e" })],
      ["API キー未設定（リモート未設定）", openai()],
      ["接続できない", openai({ cfg: { baseURL: "https://x", model: "m", apiKey: "sk" }, modelsError: "e" })],
      ["モデル未選択", openai({ cfg: { baseURL: "https://api.openai.com/v1", model: "", apiKey: "sk" } })],
      ["Claude の API キー未設定", openai({ provider: "claude", preset: { native: true, keyRequired: true } })],
    ];
    for (const [name, args] of cases) expect(computeConnection(args).needsUserAction, name).toBe(true);
  });

  it("「操作が要る」なら必ず ok=false（矛盾した組み合わせを作らない）", () => {
    for (const args of [builtin(), builtin({ weightsPresent: false }), openai(), openai({ cfg: { baseURL: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "sk" } })]) {
      const c = computeConnection(args);
      if (c.needsUserAction) expect(c.ok).toBe(false);
    }
  });

  it("needsUserAction を決める（値を書く）のは ai-generation-types.ts だけ／LlmAssist は ok・tone から自前で判定しない", () => {
    const writers = files(SRC, /\.tsx?$/)
      .filter((f) => /needsUserAction\s*:/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"));
    expect(writers).toEqual(["components/ai-generation-types.ts"]);
    expect(src("components/LlmAssist.tsx")).not.toMatch(/connection\.ok|connection\.tone\s*!==/);
  });
});

describe("#669-1 受け入れ基準 — ダイアログを開いた時点の接続設定の開閉", () => {
  it("内蔵 AI 未起動で「AI で生成」を開いても接続設定は畳まれている", () => {
    const html = dialog(fakeAi(computeConnection(builtin())));
    expect(expanded(html)).toBe(false);
    expect(html).not.toContain('type="password"');
  });

  it("リモート未設定（API キー無し）では展開", () => {
    const html = dialog(fakeAi(computeConnection(openai())));
    expect(expanded(html)).toBe(true);
    expect(html).toContain('type="password"');
  });
});

describe("#669-3 「畳んだ」の記憶（localStorage の単一フラグ・読めなくても動く）", () => {
  it("初期の開閉 = 操作が要る かつ 畳んだ記憶が無い", () => {
    expect(initialSettingsOpen({ needsUserAction: true }, false)).toBe(true);
    expect(initialSettingsOpen({ needsUserAction: true }, true)).toBe(false);
    expect(initialSettingsOpen({ needsUserAction: false }, false)).toBe(false);
    expect(initialSettingsOpen({ needsUserAction: false }, true)).toBe(false);
  });

  it("畳む → '1' を書く／開く → 消す（版に依らない 1 フラグ）", () => {
    const s = fakeStorage();
    vi.stubGlobal("localStorage", s);
    saveSettingsFolded(true);
    expect(s.map.get(AI_SETTINGS_FOLDED_KEY)).toBe("1");
    expect(loadSettingsFolded()).toBe(true);
    saveSettingsFolded(false);
    expect(s.map.has(AI_SETTINGS_FOLDED_KEY)).toBe(false);
    expect(loadSettingsFolded()).toBe(false);
  });

  it("localStorage が無い／例外を投げても落ちない（記憶なし扱い）", () => {
    expect(() => saveSettingsFolded(true)).not.toThrow(); // node: localStorage が無い
    expect(loadSettingsFolded()).toBe(false);
    const boom = () => { throw new Error("SecurityError"); };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => saveSettingsFolded(true)).not.toThrow();
    expect(() => saveSettingsFolded(false)).not.toThrow();
    expect(loadSettingsFolded()).toBe(false);
    expect(expanded(dialog(fakeAi(computeConnection(openai()))))).toBe(true); // 読めなくても従来どおり展開
  });

  it("畳んだ記憶があれば、リモート未設定でも開いた時点は畳まれている（状態は折りたたみの行に出たまま）", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [AI_SETTINGS_FOLDED_KEY]: "1" }));
    const conn = computeConnection(openai());
    const html = dialog(fakeAi(conn));
    expect(expanded(html)).toBe(false);
    expect(html).toContain(conn.label); // 何が足りないかは畳んでいても見える
  });

  it("開閉のボタンが記憶を書く（ダイアログはフラグを ai-settings-fold 経由でしか触らない）", () => {
    const s = src("components/LlmAssist.tsx");
    expect(s).toContain("saveSettingsFolded(");
    expect(s).toContain("loadSettingsFolded(");
    expect(s).not.toContain("localStorage");
  });
});

describe("#669-2 ⚙ の「AI 接続設定」項目に「…」を戻す（呼び名のキーは aiSettings.title のまま）", () => {
  it("包みキー menu.opensDialog は ja/en とも「{{title}}…」", () => {
    expect(ja.menu.opensDialog).toBe("{{title}}…");
    expect(en.menu.opensDialog).toBe("{{title}}…");
  });

  it("⚙ メニューの項目は「AI 接続設定…」（ja）／「AI connection settings…」（en）", async () => {
    // useTheme（ThemeToggle）は <html data-theme> を読む — node 環境にその 1 属性だけ渡す（先例 toolbar-settings-614）。
    vi.stubGlobal("document", { documentElement: { getAttribute: () => "dark", setAttribute: noop } });
    const panel = () => renderToStaticMarkup(<SettingsPanel onClose={noop} onAiSettings={noop} />);
    expect(panel()).toContain("✨ AI 接続設定…");
    await i18n.changeLanguage("en");
    try {
      expect(panel()).toContain("✨ AI connection settings…");
    } finally {
      await i18n.changeLanguage("ja");
    }
  });

  it("呼び名は aiSettings.title を引き、「…」を辞書の呼び名に焼き込まない", () => {
    expect(src("components/SettingsMenu.tsx")).toMatch(/t\("menu\.opensDialog", \{ title: t\("aiSettings\.title"\) \}\)/);
    expect(ja.aiSettings.title).toBe("AI 接続設定");
    expect(en.aiSettings.title).toBe("AI connection settings");
  });
});
