/**
 * ai-settings-ux-653.test.tsx — #653: AI 接続設定まわりのヒューリスティック評価（ux-principles.md §2・§5.2）。
 *
 *  1. 同じ設定の 3 表記（「接続設定」「AI 設定」「AI の接続設定…」）を辞書の 1 キー aiSettings.title に統一。
 *  2. モデル一覧が空のときの案内（modelsEmpty）を Ollama 向けとそれ以外（OpenAI／OpenRouter／custom）で分ける。
 *  3. 「AIで生成」ダイアログ（全デッキ生成）の中では、効かない「候補数（Best-of-N）」を出さない。
 *  4. 接続が使えない（connection.ok=false）ときは、ダイアログを開いた時点で設定を展開しておく。
 *  R8. 接続状態の色（tone → 色クラス）の写像は toneClass 1 か所。
 *  重大度 1: 「スライド一式」→「デッキ」・展開時に接続状態を 2 回出さない・truncate に min-w-0。
 * DOM 環境は無いので react-dom/server で描画して確かめる（先例 tests/ux-details-615.test.tsx）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import LlmAssist from "../src/components/LlmAssist";
import AiSettingsPopover from "../src/components/AiSettingsPopover";
import { toneClass } from "../src/components/ai-generation-types";
import type { AiGeneration } from "../src/components/useAiGeneration";

const noop = () => {};
const SRC = resolve(__dirname, "../src");
const src = (p: string) => readFileSync(join(SRC, p), "utf8");

afterAll(() => {
  void i18n.changeLanguage("ja");
});

const OK = { ok: true, needsUserAction: false, tone: "ok", label: "gpt-4o を使用", hint: "" };
const WARN = { ok: false, needsUserAction: true, tone: "warn", label: "APIキー未設定", hint: "下の設定に API キーを入力" };

/** OpenAI-compatible cloud provider, no models fetched (same shape as tests/ux-details-615.test.tsx). */
function fakeAi(over: Partial<Record<string, unknown>> = {}): AiGeneration {
  const ai = {
    provider: "openai",
    setProvider: noop,
    cfg: { apiKey: "", baseURL: "https://api.openai.com/v1", model: "" },
    preset: { native: false, keyRequired: true },
    setField: noop,
    rememberKey: true,
    setRememberKey: noop,
    generating: false,
    result: "",
    setResult: noop,
    error: "",
    notice: "",
    canGenerate: () => false,
    generate: noop,
    cancel: noop,
    models: [],
    modelsError: "",
    refreshModels: noop,
    ollamaModels: null,
    switchToOllama: noop,
    connection: WARN,
    switchToBuiltin: noop,
    stopBuiltin: noop,
    builtinStatus: { kind: "idle" },
    weightsPresent: null,
    builtinModel: null,
    localModelOnly: false,
    setLocalModelOnly: noop,
    localBlocked: false,
    bestOfN: 1,
    setBestOfN: noop,
    ...over,
  };
  return ai as unknown as AiGeneration;
}

const dialog = (ai: AiGeneration) =>
  renderToStaticMarkup(<LlmAssist isOpen onClose={noop} onImportResult={noop} ai={ai} />);
const toggle = (html: string) =>
  html.match(/<button[^>]*data-testid="llm-ai-settings-toggle"[^>]*>([\s\S]*?)<\/button>/);
const count = (s: string, sub: string) => s.split(sub).length - 1;

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(p) ? [p] : [];
  });
}

describe("#653-1 同じ設定は 1 つの呼び名（aiSettings.title）", () => {
  it("辞書の呼び名は ja「AI 接続設定」／en「AI connection settings」の 1 キー", () => {
    expect(ja.aiSettings.title).toBe("AI 接続設定");
    expect(en.aiSettings.title).toBe("AI connection settings");
    // 別名のキーは残さない
    expect((ja.llmAssist as Record<string, unknown>).connectionSettings).toBeUndefined();
    expect((en.llmAssist as Record<string, unknown>).connectionSettings).toBeUndefined();
    expect((ja.settings as Record<string, unknown>).aiSettings).toBeUndefined();
    expect((en.settings as Record<string, unknown>).aiSettings).toBeUndefined();
  });

  it("旧表記が辞書にも画面のソースにも残っていない（grep で 0）", () => {
    const old = /AI 設定|AI の接続設定|AI Settings|AI settings\b|"接続設定"|"Connection settings"/;
    const hits = [...files(SRC, /\.(tsx?|json)$/)]
      .filter((f) => old.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"));
    expect(hits).toEqual([]);
  });

  it("3 か所（ダイアログ・設定ポップオーバー・⚙ メニュー）が同じキーを引く", () => {
    for (const f of ["components/LlmAssist.tsx", "components/AiSettingsPopover.tsx", "components/SettingsMenu.tsx"]) {
      expect(src(f), f).toContain('t("aiSettings.title")');
    }
    const btn = toggle(dialog(fakeAi({ connection: OK })));
    expect(btn?.[1].replace(/<[^>]+>/g, "")).toContain("AI 接続設定");
    expect(renderToStaticMarkup(<AiSettingsPopover ai={fakeAi()} />)).toContain("AI 接続設定");
  });
});

describe("#653-2 モデル一覧が空のときの案内はプロバイダで分ける", () => {
  it("辞書は Ollama 向けとそれ以外の 2 文言（ja/en）", () => {
    for (const d of [ja, en]) {
      expect(d.aiSettings.modelsEmpty.ollama).toMatch(/Ollama/);
      expect(d.aiSettings.modelsEmpty.remote).not.toMatch(/Ollama|pull/);
      expect(d.aiSettings.modelsEmpty.remote).not.toBe(d.aiSettings.modelsEmpty.ollama);
    }
  });

  it("Ollama では Ollama 向け、OpenAI／OpenRouter／custom ではそれ以外の文言を出す", () => {
    const ollama = renderToStaticMarkup(
      <AiSettingsPopover ai={fakeAi({ provider: "ollama", preset: { native: false, keyRequired: false } })} />,
    );
    expect(ollama).toContain(ja.aiSettings.modelsEmpty.ollama);
    expect(ollama).not.toContain(ja.aiSettings.modelsEmpty.remote);
    for (const provider of ["openai", "openrouter", "custom"]) {
      const html = renderToStaticMarkup(<AiSettingsPopover ai={fakeAi({ provider })} />);
      expect(html, provider).toContain(ja.aiSettings.modelsEmpty.remote);
      expect(html, provider).not.toContain(ja.aiSettings.modelsEmpty.ollama);
    }
  });
});

describe("#653-3 ダイアログ（全デッキ生成）の中では候補数を出さない", () => {
  it("ダイアログ内の設定には候補数（Best-of-N）が無い／AI ドックの設定には有る", () => {
    const inDialog = dialog(fakeAi()); // ok=false → 展開済み（#653-4）
    expect(inDialog).toContain('type="password"'); // 設定は描画されている
    expect(inDialog).not.toContain(ja.aiSettings.bestOfNLabel);
    expect(inDialog).not.toContain('type="number"');
    expect(renderToStaticMarkup(<AiSettingsPopover ai={fakeAi()} />)).toContain(ja.aiSettings.bestOfNLabel);
  });
});

describe("#653-4 接続が使えないときは開いた時点で設定を展開", () => {
  it("connection.ok=false → 展開済み（aria-expanded=true・設定の入力欄が見える）", () => {
    const html = dialog(fakeAi());
    expect(toggle(html)?.[0]).toContain('aria-expanded="true"');
    expect(html).toContain('type="password"');
  });

  it("connection.ok=true → 折りたたみのまま", () => {
    const html = dialog(fakeAi({ connection: OK }));
    expect(toggle(html)?.[0]).toContain('aria-expanded="false"');
    expect(html).not.toContain('type="password"');
  });

  it("展開しても接続状態（ラベル・ヒント）は 1 回だけ出る", () => {
    const html = dialog(fakeAi());
    expect(count(html, WARN.label)).toBe(1);
    expect(count(html, WARN.hint)).toBe(1);
  });
});

describe("#653-R8 接続状態の色は toneClass 1 か所", () => {
  it("toneClass の写像", () => {
    expect(toneClass("ok")).toBe("text-green-400");
    expect(toneClass("err")).toBe("text-red-400");
    expect(toneClass("checking")).toBe("text-muted");
    expect(toneClass("warn")).toBe("text-amber-400");
  });

  it("tone を色に直す分岐は toneClass の定義だけ（3 画面は toneClass を呼ぶ）", () => {
    const branching = files(SRC, /\.tsx?$/)
      .filter((f) => /connection\.tone\s*===/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(branching).toEqual([]);
    for (const f of ["components/LlmAssist.tsx", "components/AiSettingsPopover.tsx", "components/AiPanel.tsx"]) {
      expect(src(f), f).toContain("toneClass(ai.connection.tone)");
    }
  });
});

describe("#653 重大度 1", () => {
  it("「スライド一式」をやめて「デッキ」に揃える（タイトルの「デッキを生成」と同じ語）", () => {
    expect(ja.llmAssist.modeSlides).toBe("デッキ");
    expect(JSON.stringify(ja)).not.toContain("スライド一式");
  });

  it("ダイアログの接続状態ボタンの省略表示（truncate）に min-w-0 が付く", () => {
    const btn = toggle(dialog(fakeAi({ connection: { ...OK, hint: "長いヒント" } })))?.[0] ?? "";
    expect(btn).toContain("truncate");
    expect(btn).not.toMatch(/class="(?![^"]*min-w-0)[^"]*\btruncate\b[^"]*"/);
  });
});
