/**
 * master-menu.test.tsx — #612: テンプレの操作をマスターのメニュー（MasterMenu）に集約する。
 *
 *  1. メニューは「選ぶ／取り込む／加工する／新規」の 4 区画で、渡された操作だけを区画に出す
 *     （Draft 画面は選ぶ・取り込むだけ — 調整の帯や作成ダイアログは Draft の下に隠れるため）。
 *  2. 「テンプレを強化」はメニューから、取り込み結果が無くても実行できる。足せる構造が無いときは
 *     `planAugmentation` の `reason` を添えて無効にする。
 *  3. 取り込み結果の帯からは強化のボタンを外し、メニューへの案内だけにする。案内とメニューは同じ計画
 *     （planTemplateAugmentation）から作る — 一致テスト（R8）。
 * 区画の数・1 区画の項目数の上限は tests/ux-budget.test.tsx に集約（#648）。ここは区画の中身と順を見る。
 * DOM 環境は無いので、状態を持たない MasterMenu を react-dom/server で描画して確かめる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import { MasterMenu } from "../src/components/MasterMenu";
import IntakeSummaryBar, { type IntakeResult } from "../src/components/IntakeSummaryBar";
import { planTemplateAugmentation, augmentWhat } from "../src/components/augment-offer";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import type { AugmentPlan } from "../src/engine/layout-augment-plan";
import type { MasterEntry } from "../src/components/useMasterRegistry";

const BUILTIN_GIJUTSU = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const ALL_BODY = resolve(__dirname, "fixtures/templates/Dirty_AllBody_TemplateOnly.pptx"); // タイトル＋本文 1 枠のレイアウトが無い

const masters: MasterEntry[] = [
  { id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true },
  { id: "m1", name: "会社", builtin: false },
];
const noop = () => {};
const menu = (p: Partial<Parameters<typeof MasterMenu>[0]> = {}) =>
  renderToStaticMarkup(<MasterMenu masters={masters} activeId="builtin-gijutsu" onSelect={noop} onClose={noop} {...p} />);
/** The section headings, in render order. */
const sections = (html: string) => [...html.matchAll(/data-testid="master-section-([a-z]+)"/g)].map((m) => m[1]);
/** The <button …> tag carrying the given test id (to read its attributes). */
const buttonTag = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
/** The HTML `disabled` attribute (not the Tailwind `disabled:` class variants). */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

let gijutsu: TemplateData;
let allBody: TemplateData;
beforeAll(async () => {
  gijutsu = await loadTemplate(new Uint8Array(readFileSync(BUILTIN_GIJUTSU)));
  allBody = await loadTemplate(new Uint8Array(readFileSync(ALL_BODY)));
});

describe("#612 MasterMenu: 4 つの区画", () => {
  it("top bar: 選ぶ → 取り込む → 加工する → 新規 の順に区画を出す", () => {
    const html = menu({
      onImport: noop, onRemake: noop, onAdjust: noop, onCreate: noop, onShowInfo: noop, onRemove: noop,
      augment: { plan: planTemplateAugmentation(gijutsu), onAugment: noop },
    });
    expect(sections(html)).toEqual(["select", "intake", "modify", "create"]);
    expect(html).toContain("選ぶ");
    expect(html).toContain("取り込む");
    expect(html).toContain("加工する");
    expect(html).toContain("新規");
    // 加工する = 調整・強化・取り込み結果（ⓘ は横のボタンでなくこの区画の項目）
    expect(html).toContain("テンプレート調整（書体・サイズ）…");
    expect(html).toContain('data-testid="master-augment"');
    expect(html).toContain('data-testid="master-show-info"');
    expect(html).toContain("ⓘ");
    // 削除は取り込んだものだけ（内蔵は消せない）
    expect(html.match(/🗑/g)?.length).toBe(1);
  });

  it("Draft (select + import only): 加工する・新規 の区画を出さない", () => {
    const html = menu({ onImport: noop, onRemake: noop, onRemove: noop });
    expect(sections(html)).toEqual(["select", "intake"]);
    expect(html).not.toContain('data-testid="master-augment"');
    expect(html).not.toContain("テンプレート調整");
    expect(html).not.toContain("テンプレートを作成");
  });

  it("取り込み結果が無いとき（onShowInfo なし）は ⓘ の項目を出さない", () => {
    const html = menu({ onAdjust: noop });
    expect(sections(html)).toEqual(["select", "modify"]);
    expect(html).not.toContain('data-testid="master-show-info"');
  });
});

describe("#612 MasterMenu: テンプレを強化（取り込み結果が無くても使える）", () => {
  it("内蔵の技術報告: 足りない 3 列・KPI 4 個を名指した有効な項目", () => {
    const html = menu({ augment: { plan: planTemplateAugmentation(gijutsu), onAugment: noop } });
    const tag = buttonTag(html, "master-augment");
    expect(tag).not.toBe("");
    expect(isDisabled(tag)).toBe(false);
    expect(html).toContain("テンプレートを強化（3 列・KPI 4 個を追加）…");
  });

  it("元にするレイアウトが無いテンプレ: planAugmentation の reason を添えて無効", () => {
    const plan = planTemplateAugmentation(allBody);
    expect(plan.add).toEqual([]);
    expect(plan.reason).toBeTruthy();
    const html = menu({ augment: { plan, onAugment: noop } });
    expect(isDisabled(buttonTag(html, "master-augment"))).toBe(true);
    expect(html).toContain(`テンプレートの強化はできません: ${plan.reason}`);
  });

  it("足すものが残っていない（全部ある）: 無効で、その旨を示す", () => {
    const full: AugmentPlan = {
      rule: planTemplateAugmentation(gijutsu).rule,
      add: [],
      skipped: [{ structure: "columns-2", columns: 2, reason: "2 列のレイアウト「x」が既にあります。" }],
    };
    const html = menu({ augment: { plan: full, onAugment: noop } });
    expect(isDisabled(buttonTag(html, "master-augment"))).toBe(true);
    expect(html).toContain("足りないレイアウトはありません");
  });

  it("テンプレ未読込（plan なし）: 無効", () => {
    const html = menu({ augment: { plan: null, onAugment: noop } });
    expect(isDisabled(buttonTag(html, "master-augment"))).toBe(true);
  });
});

describe("#612 取り込み結果の帯: 強化のボタンを外し、メニューへの案内だけにする", () => {
  const result: IntakeResult = { mode: "import", name: "技術報告", ts: 0, summary: { layoutCount: 13, status: "ok", findings: [] } };

  it("足せるとき: ボタンは無く、メニューと同じ『足すもの』で案内する（一致・R8）", () => {
    const html = renderToStaticMarkup(<IntakeSummaryBar busy={null} result={result} onDismiss={noop} template={gijutsu} augmentHint />);
    expect(html).not.toContain('data-testid="intake-augment"');
    expect(html).not.toContain("<button data-testid=\"intake-augment-hint\"");
    const what = augmentWhat(planTemplateAugmentation(gijutsu));
    expect(what).toBe("3 列・KPI 4 個");
    expect(html).toContain('data-testid="intake-augment-hint"');
    expect(html).toContain(`🎨 テンプレートのメニューの「テンプレートを強化」で ${what} を追加できます`);
  });

  it("協働中・調整中（augmentHint なし）は案内も出さない", () => {
    const html = renderToStaticMarkup(<IntakeSummaryBar busy={null} result={result} onDismiss={noop} template={gijutsu} />);
    expect(html).not.toContain("intake-augment");
  });

  it("足せないテンプレでは案内を出さない（理由はメニュー側に出る）", () => {
    const html = renderToStaticMarkup(<IntakeSummaryBar busy={null} result={result} onDismiss={noop} template={allBody} augmentHint />);
    expect(html).not.toContain("intake-augment");
  });
});
