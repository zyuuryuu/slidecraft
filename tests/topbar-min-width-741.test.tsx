/**
 * topbar-min-width-741.test.tsx — #741（B 案・ユーザ裁定）: 狭い窓で 🎨 の名前を隠して「🎨 ▾」だけにしても、
 * ボタンのアクセシブルネームはテンプレート名を持つ。aria-label「テンプレート：<名前>」を辞書（ja／en）経由で付ける。
 * 860px 未満で前置き「テンプレート：」が見た目から落ちる件（#742 統括レビューの追記）も、この aria-label で読み上げに残る。
 * 寸法（何 px で名前を隠すか・7 ボタンが重ならないか）は e2e（tests/e2e/topbar-width-713.spec.ts）で測る。
 * DOM 環境は無いので react-dom/server で描画する（先例 tests/ux-findings-713.test.tsx）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import MasterPicker from "../src/components/MasterPicker";
import type { MasterEntry } from "../src/components/useMasterRegistry";

const noop = () => {};
const masters: MasterEntry[] = [{ id: "builtin-gijutsu", name: "技術報告 スタンダード水色", builtin: true }];
const ariaLabel = (activeId: string) =>
  renderToStaticMarkup(<MasterPicker masters={masters} activeId={activeId} onSelect={noop} />).match(
    /<button[^>]*\saria-label="([^"]*)"/,
  )?.[1];

afterAll(() => {
  void i18n.changeLanguage("ja");
});

describe("#741 🎨 テンプレートのボタンのアクセシブルネーム", () => {
  it("辞書の masterPicker.buttonLabel は ja／en とも前置きの語と {{name}} を持つ", () => {
    expect(ja.masterPicker.buttonLabel).toBe("テンプレート：{{name}}");
    expect(en.masterPicker.buttonLabel).toBe("Template: {{name}}");
  });

  for (const lang of ["ja", "en"] as const) {
    it(`${lang}: aria-label ＝ 辞書の buttonLabel にテンプレート名を入れたもの（未選択なら selectMaster）`, async () => {
      await i18n.changeLanguage(lang);
      const dict = lang === "ja" ? ja : en;
      expect(ariaLabel("builtin-gijutsu")).toBe(dict.masterPicker.buttonLabel.replace("{{name}}", "技術報告 スタンダード水色"));
      expect(ariaLabel("missing")).toBe(dict.masterPicker.buttonLabel.replace("{{name}}", dict.masterPicker.selectMaster));
    });
  }
});
