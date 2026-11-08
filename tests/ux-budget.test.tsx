/**
 * ux-budget.test.tsx — UX 予算（ADR-0039 G4-b・docs/design/ux-principles.md §3／§7）。#648 で 1 ファイルに集約。
 *
 * UX 予算＝研究で確かめられた法則（Hick・Cowan・段階的開示・認知負荷・シグニファイア・語の一致）から導いた
 * 数値の上限。機能を足すたびに画面が混むのを、レビューの好みでなく CI で止める。数値は ここ（BUDGET と
 * 凍結リスト）だけが持つ。機能テスト（どのボタンがどの順に出るか）は元のファイルに残す（R8: 同じ数値を
 * 2 か所で持たない）。
 *
 * ratchet 運用（tests/arch-conformance.test.ts・ADR-0031 と同じ）:
 *  - BUDGET の値と凍結リストは「今の値」。上げる・足す変更は原則 NG。上げるなら PR 本文に理由を書く
 *    （PR テンプレ「UX への影響」欄）。
 *  - 改善で値が下がったら、ここを下げ（凍結リストからは消し）、docs/shipped.md に 1 行書く。
 *  - 凍結リスト（FROZEN_*）は予算を超えている既存の箇所。目標は空。新しい違反は凍結リストに足さずに直す。
 *
 * DOM 環境は無いので react-dom/server で描画して数える（先例 tests/master-menu.test.tsx）。開いた状態の
 * メニューを数えるときは、boolean の useState を全部「開」で始める（forceOpen）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import Toolbar from "../src/components/Toolbar";
import MasterPicker from "../src/components/MasterPicker";
import { MasterMenu } from "../src/components/MasterMenu";
import NoticeSlot from "../src/components/NoticeSlot";
import type { IntakeResult } from "../src/components/IntakeSummaryBar";
import type { AdjustSession } from "../src/components/useTemplateAdjust";
import type { MasterEntry } from "../src/components/useMasterRegistry";
import { i18nLeaks, menuDepth, groupItems } from "./ux-budget-probes";
import DeepMenu from "./fixtures/ux-budget/DeepMenu";

/** 予算（上限）。§7 の初期値＝現在値。 */
const BUDGET = {
  /** Hick: 上部バーに常に見えるボタン（#614 で 12 → 7）。 */
  topBarButtons: 7,
  /** 認知負荷: 本文を押し下げる帯の同時表示（#613）。 */
  noticeBands: 1,
  /** Cowan: マスターのメニューの区画（#612）。 */
  menuSections: 4,
  /** Miller: 1 区画の項目。 */
  itemsPerSection: 7,
  /** 段階的開示（Nielsen 2006）: 上部バー → ⚙ → 項目 の 2 段まで。 */
  menuDepth: 2,
} as const;

// ── 凍結リスト（予算を超えている既存の箇所。目標は空）──────────────────────────────────
/** 深さ 3 のメニュー項目: ファイル ▾ → 🌐 HTML ▸ → 遷移の種類（#648 の実測で判明。ux-principles §7 は ≤ 2 と書いていた）。#650 で空にする。 */
const FROZEN_DEEP_ITEMS = ["スライド既定", "フェード", "ズーム", "プッシュ"];
/** i18n を通らない文言の、ファイルごとの現在数（main の実測）。#615 で 0 にする（形式名 PPTX・.scft 等を
 *  辞書に入れるか許可リストにするかも #615 で決める）。許可リスト（I18N_ALLOWED）は空から始める。 */
const FROZEN_I18N_LEAKS: Record<string, number> = {
  "App.tsx": 1,
  "components/AiSettingsPopover.tsx": 3,
  "components/ClaudeRegisterFlow.tsx": 2,
  "components/CollabDiagnostics.tsx": 1,
  "components/CollabPanel.tsx": 2,
  "components/DiagramEditor.tsx": 6,
  "components/DiagramSvgOverlay.tsx": 1,
  "components/DocTabs.tsx": 1,
  "components/InitializeModal.tsx": 1,
  "components/LayoutEditor.tsx": 1,
  "components/LlmAssist.tsx": 25,
  "components/ResizableSplit.tsx": 1,
  "components/ReviewBar.tsx": 1,
  "components/SlideEditor.tsx": 6,
  "components/StatusBar.tsx": 9,
  "components/TemplateCreator.tsx": 2,
  "components/Toolbar.tsx": 8,
};
/** やむを得ず直書きを認める文言（"ファイル:文言"）。足すなら PR 本文に理由。 */
const I18N_ALLOWED = new Set<string>([]);

// ── 描画の準備 ──────────────────────────────────────────────────────────────────
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
const SRC = resolve(__dirname, "../src");
const masters: MasterEntry[] = [
  { id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true },
  { id: "m1", name: "会社", builtin: false },
];

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
      master={
        <MasterPicker masters={masters} activeId="builtin-gijutsu" onSelect={noop} onImport={noop} onRemake={noop}
          onAdjust={noop} onShowInfo={noop} onCreate={noop} onRemove={noop} />
      }
    />,
  );
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

const walk = (dir: string, ext: RegExp, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(n)) out.push(p);
  }
  return out;
};
const relSrc = (f: string) => relative(SRC, f).replace(/\\/g, "/");

// ── 道具の自己検査（意図的に違反した fixture で、数える道具が違反を見落とさないことを確かめる）──
describe("道具の自己検査（fixture）", () => {
  it("i18nLeaks: 直書きの文言・title/aria-label/placeholder を拾い、コメント・t()・記号だけのラベルは拾わない", () => {
    const src = readFileSync(resolve(__dirname, "fixtures/ux-budget/LeakyLabels.tsx"), "utf8");
    expect(i18nLeaks(src).map((l) => `${l.kind}:${l.text}`)).toEqual([
      "title:Leaky title",
      "text:保存する",
      "placeholder:Loading…",
      "text:Ready",
      "aria-label:items",
    ]);
  });

  it("menuDepth: バー → メニュー → サブメニュー → 項目 を 3 段と数え、ボタンの無い位置決めの箱は数えない", () => {
    expect(menuDepth(renderToStaticMarkup(<DeepMenu />))).toEqual({ depth: 3, deepest: ["Deep item"] });
  });

  it("groupItems: 区画ごとに、ボタンを含む直下の要素を数える（見出し・区切り線は数えない・一覧は 1 項目）", () => {
    const html =
      '<div role="group" aria-label="A"><div class="h-px"></div><div>見出し</div><div><button>1</button><button>2</button></div>' +
      '<button>3</button><img src="x"/></div><div role="group" aria-label="B"><div>見出し</div></div>';
    expect(groupItems(html)).toEqual([{ label: "A", items: 2 }, { label: "B", items: 0 }]);
  });
});

// ── 予算 ────────────────────────────────────────────────────────────────────────
describe("UX 予算（ADR-0039）", () => {
  it(`Hick: 上部バーに常に見えるボタンは ${BUDGET.topBarButtons} 個以下`, () => {
    expect(buttons(topBar()).length).toBeLessThanOrEqual(BUDGET.topBarButtons);
  });

  it(`認知負荷: 本文を押し下げる帯は、通知が何通り重なっても ${BUDGET.noticeBands} 本以下`, () => {
    const result: IntakeResult = { mode: "import", name: "会社.pptx", summary: { status: "ok", layoutCount: 13, findings: [] }, ts: 1 };
    const session = {
      sourceName: "会社",
      slots: { major: { latin: "Arial", ea: "", jpan: "" }, minor: { latin: "Arial", ea: "", jpan: "" } },
    } as unknown as AdjustSession;
    for (const adjusting of [false, true]) for (const intake of [false, true]) for (const update of [false, true]) {
      const html = renderToStaticMarkup(
        <NoticeSlot
          update={update ? { latestVersion: "9.9.9", onDismiss: noop } : null}
          intake={{ busy: null, result: intake ? result : null, onDismiss: noop }}
          adjust={adjusting ? { session, busy: false, onPreview: noop, onApply: noop, onCancel: noop } : null}
        />,
      );
      // 帯の根は role="status"（更新通知・取り込み結果）か role="region"（テンプレ調整）。
      const bands = (html.match(/role="(status|region)"/g) ?? []).length;
      expect(bands, `adjusting=${adjusting} intake=${intake} update=${update}`).toBeLessThanOrEqual(BUDGET.noticeBands);
    }
  });

  it(`Cowan/Miller: マスターのメニューは ${BUDGET.menuSections} 区画以下・1 区画 ${BUDGET.itemsPerSection} 項目以下`, () => {
    const html = renderToStaticMarkup(
      <MasterMenu masters={masters} activeId="builtin-gijutsu" onSelect={noop} onClose={noop} onImport={noop} onRemake={noop}
        onAdjust={noop} augment={{ plan: null, onAugment: noop }} onShowInfo={noop} onCreate={noop} onRemove={noop} />,
    );
    const groups = groupItems(html);
    expect(groups.length).toBeGreaterThan(0); // 数え漏れの防止（区画を 1 つも拾えなければ道具が壊れている）
    expect(groups.length).toBeLessThanOrEqual(BUDGET.menuSections);
    for (const g of groups) expect(g.items, g.label).toBeLessThanOrEqual(BUDGET.itemsPerSection);
  });

  it(`段階的開示: メニューのネストは ${BUDGET.menuDepth} 段まで（凍結リストの項目を除く）`, () => {
    const html = withAllOpen(topBar);
    // 全部「開」で描いた＝ファイル・🎨・⚙ のメニューが実際に出ている（数え漏れの防止）。
    expect(html).toContain("📊 PPTX");
    expect(html).toContain('data-testid="master-section-select"');
    expect(html).toContain("ヘルプ（ドキュメント）");
    const tooDeep = (budget: number) => {
      const r = menuDepth(html);
      return r.depth > budget ? r.deepest : [];
    };
    expect(tooDeep(BUDGET.menuDepth)).toEqual(FROZEN_DEEP_ITEMS);
    expect(tooDeep(BUDGET.menuDepth + 1)).toEqual([]);
  });

  describe("シグニファイア: 記号 → 意味の 1 対 1（#614）", () => {
    // ✨ の使用箇所の許可リスト。AI の機能（AI ドック・✨直す・AI で生成・テンプレ作成の AI 欄）だけ。
    // ここに足す変更は「その機能は AI か」をレビューで問う（AI でない機能に ✨ を戻さない）。
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
    // A comment line (// …, * …, /* …, {/* …) documents ✨, it does not render it.
    const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line) || /^\s*[^"'`]*\/\/.*✨/.test(line);

    it("src の画面コードで ✨ を描くのは許可リストのファイルだけ", () => {
      const hits: string[] = [];
      for (const f of walk(SRC, /\.(ts|tsx)$/)) {
        const rel = relSrc(f);
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

    it("＋ は追加だけ: マスターのメニューで ＋ が付くのは「テンプレを作成」だけ", () => {
      const b = buttons(
        renderToStaticMarkup(
          <MasterMenu masters={masters} activeId="builtin-gijutsu" onSelect={noop} onClose={noop} onImport={noop} onRemake={noop} onCreate={noop} />,
        ),
      );
      expect(b.filter((x) => x.startsWith("＋")).map((x) => x.includes("テンプレを作成"))).toEqual([true]);
    });
  });

  it("語の一致: i18n を通らない文言は、ファイルごとの凍結数を超えない（新しいファイルは 0）", () => {
    const now: Record<string, number> = {};
    for (const f of walk(SRC, /\.tsx$/)) {
      const rel = relSrc(f);
      const leaks = i18nLeaks(readFileSync(f, "utf8"), f).filter((l) => !I18N_ALLOWED.has(`${rel}:${l.text}`));
      if (leaks.length) now[rel] = leaks.length;
    }
    const over = Object.entries(now)
      .filter(([rel, n]) => n > (FROZEN_I18N_LEAKS[rel] ?? 0))
      .map(([rel, n]) => `${rel}: ${n} > ${FROZEN_I18N_LEAKS[rel] ?? 0}`);
    expect(over).toEqual([]);
  });

  // e2e（実ブラウザの寸法・色）で測る項目。#648 では枠だけ（#649 で実装）。
  it.todo("WCAG 2.2 2.5.8: クリック標的は 24×24 CSS px 以上");
  it.todo("WCAG 2.2 1.4.3: 文字のコントラストは 4.5:1 以上");
  it.todo("KLM: 代表タスク 3 本の予測時間が固定値を超えない");
});
