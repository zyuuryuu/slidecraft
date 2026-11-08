/**
 * ux-details-615.test.tsx — #615: UX の細部の整理。
 *
 *  1. AI の接続設定（プロバイダ・モデル・Base URL・API キー・キーの記憶・ローカルモデル限定）の入力欄は
 *     AiSettingsPopover だけに置く。「AIで生成」ダイアログ（LlmAssist）は同じコンポーネントを開くだけ。
 *     ダイアログにしか無かった機能（キーの表示／非表示・モデル一覧が取れないときの案内）は移して残す。
 *  2. 英語のままだったラベルを辞書（src/i18n/locales/ja.json・en.json）に通す。
 *  3. ステータスバーは、ほかで出していない情報（開いているファイルのパス）だけを出す。
 *  5. やり直すのツールチップに Ctrl+Y も書く。
 * DOM 環境は無いので react-dom/server で描画して確かめる（先例 tests/toolbar-settings-614.test.tsx）。
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
import StatusBar from "../src/components/StatusBar";
import ResizableSplit from "../src/components/ResizableSplit";
import SlideEditor from "../src/components/SlideEditor";
import DiagramEditor from "../src/components/DiagramEditor";
import { parseMd } from "../src/engine/md-parser";
import type { AiGeneration } from "../src/components/useAiGeneration";

const noop = () => {};
const SRC = resolve(__dirname, "../src");
const src = (p: string) => readFileSync(join(SRC, p), "utf8");

afterAll(() => {
  void i18n.changeLanguage("ja");
});

/** A cloud provider (OpenAI-compatible, not native) with no models fetched — the state that shows the
 *  most connection controls (Base URL + model text box + key + remember + models hint). */
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
    connection: { ok: false, needsUserAction: true, tone: "warn", label: "APIキー未設定", hint: "" },
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

const dialog = () => renderToStaticMarkup(<LlmAssist isOpen onClose={noop} onImportResult={noop} ai={fakeAi()} />);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("#615-1 AI の接続設定は 1 か所（AiSettingsPopover）", () => {
  it("接続設定を書き換える呼び出しは AiSettingsPopover（とその部品 LocalOnlyToggle）にしか無い", () => {
    const writers = /\bai\.(setProvider|setField|setRememberKey|setLocalModelOnly)\(/;
    const found = tsxFiles(SRC)
      .filter((f) => writers.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .sort();
    expect(found).toEqual(["components/AiSettingsPopover.tsx", "components/LocalOnlyToggle.tsx"]);
    const togglers = tsxFiles(SRC).filter((f) => /<LocalOnlyToggle\b/.test(readFileSync(f, "utf8")));
    expect(togglers.map((f) => relative(SRC, f).replace(/\\/g, "/"))).toEqual(["components/AiSettingsPopover.tsx"]);
  });

  it("「AIで生成」ダイアログは入力欄を持たず、AiSettingsPopover を開くボタンと接続状態を出す", () => {
    // #653: 接続が使えない（ok=false）と開いた時点で設定を展開するので、ここは接続済みの状態で見る。
    const ai = fakeAi({ connection: { ok: true, needsUserAction: false, tone: "ok", label: "gpt-4o を使用", hint: "" } });
    const html = renderToStaticMarkup(<LlmAssist isOpen onClose={noop} onImportResult={noop} ai={ai} />);
    expect(html).not.toContain('type="password"'); // API キー欄
    expect(html).not.toContain('type="checkbox"'); // キーの記憶・ローカルモデル限定
    expect(html).not.toContain("<select"); // プロバイダ・モデル
    expect(html).toContain("gpt-4o を使用"); // 現在の接続状態は見える
    const btn = html.match(/<button[^>]*data-testid="llm-ai-settings-toggle"[^>]*>([\s\S]*?)<\/button>/);
    expect(btn?.[0]).toContain('aria-expanded="false"');
    expect(btn?.[1].replace(/<[^>]+>/g, "")).toContain("接続設定");
    expect(src("components/LlmAssist.tsx")).toMatch(/<AiSettingsPopover ai=\{ai\} surface="dialog" \/>/); // #653: ダイアログ向けの表示（候補数なし）
  });

  it("ダイアログにしか無かった機能を AiSettingsPopover に移す（キーの表示切替・モデル一覧の案内）", () => {
    const html = renderToStaticMarkup(<AiSettingsPopover ai={fakeAi()} />);
    expect(html).toContain('type="password"');
    expect(html).toMatch(/<button[^>]*data-testid="ai-key-visibility"[^>]*>表示<\/button>/);
    expect(html).toContain(ja.aiSettings.modelsEmpty.remote); // #653: openai なので Ollama 向けでない方
    const err = renderToStaticMarkup(<AiSettingsPopover ai={fakeAi({ modelsError: "HTTP 401" })} />);
    expect(err).toContain("HTTP 401");
  });
});

describe("#615-2 英語のままのラベルを辞書へ（日本語表示）", () => {
  it("「AIで生成」ダイアログに英語のままのラベルが残っていない", () => {
    const html = dialog();
    for (const s of [
      "What do you want to create", "Slide Deck", ">Diagram<", "AI provider", ">Generate<", "Cancel",
      "Or copy the prompt", "Result", "Import to SlideCraft", "Generated Markdown",
    ]) expect(html).not.toContain(s);
    expect(html).toContain(ja.llmAssist.importToSlideCraft);
    expect(html).toContain(ja.llmAssist.modeSlides);
  });

  it("英語表示では英語のラベルになる（辞書を通っている）", async () => {
    await i18n.changeLanguage("en");
    try {
      const html = dialog();
      expect(html).toContain("Import to SlideCraft");
      expect(html).toContain("Slide Deck");
      expect(html).toContain("AI connection settings"); // #653: aiSettings.title に統一
    } finally {
      await i18n.changeLanguage("ja");
    }
  });

  it("区切り線のツールチップ", () => {
    const html = renderToStaticMarkup(<ResizableSplit left={null} right={null} />);
    expect(html).not.toContain("Drag to resize");
    expect(html).toContain(`title="${ja.resizableSplit.dividerTitle}"`);
  });

  it("スライドエディタの「Layout」見出しと「⟳ Auto」", () => {
    const slide = parseMd("# 表紙\n\n- 本文").slides[0];
    const html = renderToStaticMarkup(<SlideEditor slide={slide} layout={undefined} onChange={noop} />);
    expect(html).not.toContain(">Layout<");
    expect(html).toContain(`>${ja.slideEditor.layout}<`);
    // 「⟳ Auto」は展開時だけ描画される → 文言が辞書キー経由であることを源で確かめる
    expect(src("components/SlideEditor.tsx")).not.toContain("⟳ Auto");
    expect(ja.slideEditor.resetToAuto).toBe("⟳ 自動");
  });

  it("図の編集の形式名と「✓ valid」", () => {
    const slide = parseMd("# 図\n\n```diagram\ntype: flowchart\nnodes:\n  - id: a\n    label: A\n```").slides[0];
    expect(slide.diagram?.yaml).toBeTruthy(); // 前提: 図のあるスライド
    const html = renderToStaticMarkup(<DiagramEditor slide={slide} onUpdateDiagramYaml={noop} onUpdateMermaid={noop} onChange={noop} />);
    expect(html).not.toContain("✓ valid");
    expect(html).toContain(ja.diagramEditor.valid);
    const s = src("components/DiagramEditor.tsx");
    for (const lit of [">YAML<", ">JSON<", '"MERMAID"']) expect(s).not.toContain(lit);
    expect(html).toContain(`>${ja.diagramEditor.formatMermaid}<`);
  });

  it("フォームと Markdown の切り替えの「Markdown」も辞書を通る", () => {
    expect(src("App.tsx")).not.toMatch(/>\s*Markdown\s*</);
    expect(src("App.tsx")).toContain('t("app.viewMarkdown")');
    expect(ja.app.viewMarkdown).toBe("Markdown"); // 形式名なので日本語表示でも同じ（e2e もこの名前で探す）
  });
});

describe("#615-3 ステータスバーは開いているファイルのパスだけ", () => {
  it("パスが無ければ何も描かない（「No input」「Ready」を出さない）", () => {
    expect(renderToStaticMarkup(<StatusBar filePath={null} />)).toBe("");
  });
  it("パスがあればそれだけを出す（エラーはプレビューに出るので重ねない）", () => {
    const html = renderToStaticMarkup(<StatusBar filePath={"C:\\deck\\report.md"} />);
    expect(html).toContain("C:\\deck\\report.md");
    for (const s of ["No input", "Error", "Ready", "Nodes"]) expect(html).not.toContain(s);
  });
});

describe("#615-5 やり直すのツールチップ", () => {
  it("Ctrl+Shift+Z と Ctrl+Y の両方を書く（useDeckController は両方を受ける）", () => {
    for (const d of [ja, en]) {
      expect(d.toolbar.redo).toContain("Shift+Z");
      expect(d.toolbar.redo).toContain("Ctrl+Y");
    }
    expect(src("components/useDeckController.ts")).toMatch(/k === "y" \|\| e\.shiftKey/);
  });
});
