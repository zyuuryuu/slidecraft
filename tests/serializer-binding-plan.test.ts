/**
 * serializer-binding-plan.test.ts — ADR-0030 段階B: serializer の読み出しを BindingPlan 経由に置換。
 *
 * Issue #144: serializer は placeholder → Markdown の逆写像をレイアウト「名」由来の名前空間
 * （isTitleNamespace）で決めていたため、catalog なしの autoSelectLayout が canonical fallback 名
 * （例: closing 語彙「まとめ」→ Closing.1Message.Single）に解決すると、実際の束縛（catalog あり・
 * 例: Dirty_Legacy43 の「図表」= title 型 + typeless idx=13）と名前空間が乖離し、タイトルが空の
 * title 名前空間（idx 0）から読まれて消え、本文 idx 1 が「## …」（サブタイトル）に化けた。
 *
 * 段階B は読み出しを slideBindingPlan（export/preview と同一 dispatch）の ContentRef ロールに揃える
 * （ADR-0011 bijection: 束縛に使った写像と同じものを読み出しにも使う）。
 *
 * 絶対不変条件: 健全テンプレ（規約 idx のみ）の round-trip は byte-identical（旧経路と一字一句一致）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";

const fx = (p: string) => readFileSync(resolve(__dirname, "fixtures/templates", p));

// Issue #144 の repro をそのまま固定: 表紙(meta 付き) + closing 語彙タイトルの本文スライド。
const REPRO_MD = "# 表紙\n\nCategory: X\n\n---\n\n# まとめ\n\n- 論点A\n- 論点B\n";

describe("issue #144 — typeless 非規約 idx 枠に本文が束縛されたスライドの round-trip", () => {
  it("Dirty_Legacy43: タイトルが残り、箇条書きは本文のまま（## 化しない）", async () => {
    const s = S.createSession();
    await S.newProject(s, fx("Dirty_Legacy43_TemplateOnly.pptx"), REPRO_MD);
    const out = S.getDeckMarkdown(s);
    expect(out).toBe("# 表紙\n\nCategory: X\n\n---\n\n# まとめ\n\n- 論点A\n- 論点B\n");
  });

  it("Dirty_Legacy43: round-trip した Markdown の再パースが同じ IR（15=title / 1=body）に戻る", async () => {
    const s = S.createSession();
    await S.newProject(s, fx("Dirty_Legacy43_TemplateOnly.pptx"), REPRO_MD);
    const reparsed = parseMd(S.getDeckMarkdown(s)).slides[1];
    const text = (idx: string) =>
      reparsed.placeholders
        .find((p) => p.idx === idx)
        ?.paragraphs.map((pp) => pp.segments.map((sg) => sg.text).join(""))
        .join("\n");
    expect(text("15")).toBe("まとめ");
    expect(text("1")).toBe("論点A\n論点B");
  });

  it("canonical (Midnight): closing 語彙タイトルの最終スライドでもタイトルが round-trip で残る", async () => {
    const s = S.createSession();
    await S.newProject(s, fx("Midnight_Executive_30_TemplateOnly.pptx"), REPRO_MD);
    expect(S.getDeckMarkdown(s)).toContain("# まとめ");
  });
});

describe("ADR-0030 段階B — 健全デッキは BindingPlan 経由でも byte-identical", () => {
  it("Midnight 代表デッキ（表紙+meta / 本文 / 2カラム）: serializeMd(deck, tpl) === serializeMd(deck)", async () => {
    const s = S.createSession();
    const healthy =
      "# 表紙\n\n## サブ\n\nCategory: 部門\n\n---\n\n# 本文\n\n- a\n- b\n\n---\n\n# 比較\n\n<!-- col -->\n- 左\n\n<!-- col -->\n- 右\n";
    await S.newProject(s, fx("Midnight_Executive_30_TemplateOnly.pptx"), healthy);
    const deck = S.getDeck(s);
    const withPlan = serializeMd(deck, { catalog: s.catalog!, layouts: s.template!.layouts });
    expect(withPlan).toBe(serializeMd(deck));
  });
});
