/**
 * ai-dock-deck-guidance-690.test.tsx — #690: AI ドックはスライド未選択だと「生成」を押せない
 * （`ready` は `batch || canSlide` を要求）のに、入力欄が「作りたいデッキを指示…」と案内していた。
 *
 *  1. 未選択（!canSlide かつ一括でない）→ 入力欄と「生成」を出さず、1 行の案内を出す。案内の
 *     ［📝 原稿 → ✨ AIで生成］はボタンで、既存の 📝 原稿ボタンと同じハンドラ（onOpenDraft）を呼ぶ。
 *  2. 選択中 → 今までどおり入力欄と「生成」。一括（複数選択）も今までどおり。
 *  3. 原稿が開けないとき（協働中＝locked・テンプレ調整中＝busy。📝 原稿ボタンの draftGate と同じ）→
 *     リンクを無効にし、理由を同じ 1 行に出す。
 *  4. 使われなくなった aiPanel.deckPromptPlaceholder は辞書（ja／en）から外す。
 * DOM 環境は無いので react-dom/server で描画して確かめる（先例 tests/ai-settings-ux-653.test.tsx）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import AiPanel from "../src/components/AiPanel";
import type { AiGeneration } from "../src/components/useAiGeneration";

const noop = () => {};

// AiPanel reads its persisted height from localStorage in a state initializer; node has none.
const hadStorage = "localStorage" in globalThis;
const prevStorage = (globalThis as { localStorage?: unknown }).localStorage;
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: noop, removeItem: noop },
  });
});
afterAll(() => {
  if (hadStorage) Object.defineProperty(globalThis, "localStorage", { configurable: true, value: prevStorage });
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  void i18n.changeLanguage("ja");
});

function fakeAi(): AiGeneration {
  const ai = {
    connection: { ok: true, tone: "ok", label: "gpt-4o を使用", hint: "" },
    tasks: [],
    candidates: [],
    result: "",
    error: "",
    notice: "",
    generating: false,
    bestOfRunning: false,
    bestOfN: 1,
    canGenerate: () => true,
    generate: noop,
    generateBest: noop,
    retry: noop,
    reset: noop,
    cancel: noop,
    cancelTask: noop,
    clearTasks: noop,
  };
  return ai as unknown as AiGeneration;
}

type PanelProps = Partial<Parameters<typeof AiPanel>[0]>;
const panel = (p: PanelProps = {}) =>
  renderToStaticMarkup(<AiPanel onClose={noop} ai={fakeAi()} onApplySlide={noop} onOpenDraft={noop} {...p} />);

const guidance = (html: string) => html.match(/<div[^>]*data-testid="ai-deck-guidance"[^>]*>([\s\S]*?)<\/div>/);
const link = (html: string) => html.match(/<button[^>]*data-testid="ai-deck-guidance-open-draft"[^>]*>[\s\S]*?<\/button>/)?.[0];
const LOCKED = "協働中は原稿を開けません（協働を停止すると使えます）";

describe("#690-1 スライド未選択: 入力欄の代わりに 1 行の案内", () => {
  it("入力欄（textarea）と「生成」ボタンを出さない", () => {
    const html = panel({ currentSlideMd: undefined });
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(`>${ja.aiPanel.generate}</button>`);
  });

  it("「スライドを選ぶと…／デッキを丸ごと作るときは［📝 原稿 → ✨ AIで生成］」を出す", () => {
    const g = guidance(panel({ currentSlideMd: undefined }));
    expect(g).not.toBeNull();
    const text = g![1].replace(/<[^>]+>/g, "");
    expect(text).toContain("スライドを選ぶと、そのスライドを AI で直せます。デッキを丸ごと作るときは");
    expect(text).toContain("［📝 原稿 → ✨ AIで生成］");
  });

  it("案内のリンクはボタンで、原稿が開けるときは押せる", () => {
    const b = link(panel({ currentSlideMd: undefined }));
    expect(b).toBeDefined();
    expect(b).not.toContain(`disabled=""`);
  });

  it("「作りたいデッキを指示」は画面にも辞書にも残らない", () => {
    expect(panel({ currentSlideMd: undefined })).not.toContain("作りたいデッキを指示");
    expect("deckPromptPlaceholder" in ja.aiPanel).toBe(false);
    expect("deckPromptPlaceholder" in en.aiPanel).toBe(false);
  });

  it("en でも同じ 1 行が辞書経由で出る", async () => {
    await i18n.changeLanguage("en");
    try {
      const text = guidance(panel({ currentSlideMd: undefined }))![1].replace(/<[^>]+>/g, "");
      expect(text).toContain("[📝 Draft → ✨ Generate with AI]");
      expect(text).not.toContain("原稿");
    } finally {
      await i18n.changeLanguage("ja");
    }
  });
});

describe("#690-2 選択中・一括は今までどおり", () => {
  it("1 枚選択: 入力欄と「生成」が出て、案内は出ない", () => {
    const html = panel({ currentSlideMd: "# タイトル", activeSlideNum: 2 });
    expect(html).toContain("<textarea");
    expect(html).toContain(ja.aiPanel.slidePromptPlaceholder);
    expect(html).toContain(`>${ja.aiPanel.generate}</button>`);
    expect(guidance(html)).toBeNull();
  });

  it("複数選択（一括）: 入力欄と「N 枚を編集」が出て、案内は出ない", () => {
    const html = panel({ currentSlideMd: "# タイトル", selectedCount: 3, onBatchEdit: noop });
    expect(html).toContain("<textarea");
    expect(html).toContain(i18n.t("aiPanel.editSlidesButton", { count: 3 }));
    expect(guidance(html)).toBeNull();
  });
});

describe("#690-3 原稿が開けないとき（📝 原稿ボタンの draftGate と同じ）", () => {
  it("協働中（locked）: リンクは無効で、理由を同じ 1 行に出す", () => {
    const html = panel({ currentSlideMd: undefined, draftGate: "locked" });
    expect(link(html)).toContain(`disabled=""`);
    expect(guidance(html)![1].replace(/<[^>]+>/g, "")).toContain(LOCKED);
  });

  it("テンプレ調整中（busy）: リンクは無効で、理由を同じ 1 行に出す", () => {
    const html = panel({ currentSlideMd: undefined, draftGate: "busy" });
    expect(link(html)).toContain(`disabled=""`);
    expect(guidance(html)![1].replace(/<[^>]+>/g, "")).toContain(ja.aiPanel.deckGuidanceBusy);
  });

  it("開けるときは理由を出さない", () => {
    const text = guidance(panel({ currentSlideMd: undefined }))![1].replace(/<[^>]+>/g, "");
    expect(text).not.toContain(LOCKED);
  });
});
