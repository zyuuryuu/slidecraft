/**
 * #713（所見 6・7 の幅確認）: 狭い窓（760px 未満）でも上部バーが崩れない — 実ブラウザの寸法で測る。
 *  - 7 つのボタンが互いに重ならず、窓の中に収まる（「開く・保存・書き出し」で 1 つ目のボタンが長くなった）。
 *  - 🎨 テンプレートの前置き「テンプレート：」は、出すなら丸ごと（端数で「…」が付かない）。丸ごと入らない 860px 未満では
 *    出さず、名前に幅を回す（Issue の直し方「幅が足りないときは前置きを落として名前だけに」）。
 * jsdom ではレイアウトを測れないので e2e に置く（単体テストは tests/ux-findings-713.test.tsx）。
 */
import { test, expect, type Page } from "@playwright/test";

async function barBoxes(page: Page) {
  return page.getByTestId("top-bar").evaluate((bar) =>
    [...bar.querySelectorAll("button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: (b.textContent ?? "").trim(), left: r.left, right: r.right };
    }),
  );
}

for (const width of [740, 861, 1280]) {
  for (const lang of ["ja", "en"] as const) {
    test(`top bar at ${width}px (${lang}): 7 buttons, no overlap, all inside the window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/");
      const bar = page.getByTestId("top-bar");
      if (lang === "en") {
        await bar.getByRole("button", { name: "設定", exact: true }).click();
        await page.getByRole("button", { name: "EN", exact: true }).click();
        await page.keyboard.press("Escape");
      }
      await expect(bar.getByRole("button", { name: lang === "ja" ? /^開く・保存・書き出し/ : /^Open · Save · Export/ })).toBeVisible();

      const boxes = (await barBoxes(page)).sort((a, b) => a.left - b.left);
      expect(boxes).toHaveLength(7);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].left, `${boxes[i - 1].text} | ${boxes[i].text}`).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
      }
      expect(boxes[0].left).toBeGreaterThanOrEqual(0);
      expect(boxes[boxes.length - 1].right).toBeLessThanOrEqual(width);

      const prefix = bar.getByText(lang === "ja" ? "テンプレート：" : "Template:", { exact: true });
      if (width < 860) {
        await expect(prefix).toBeHidden();
      } else {
        await expect(prefix).toHaveCSS("text-overflow", "ellipsis");
        // 箱の幅 ≥ 文字そのものの幅（Range で測る。scrollWidth は整数に丸まるので使わない）＝端数も削られていない。
        const { box, glyphs } = await prefix.evaluate((s) => {
          const r = document.createRange();
          r.selectNodeContents(s);
          return { box: s.getBoundingClientRect().width, glyphs: r.getBoundingClientRect().width };
        });
        expect(box).toBeGreaterThanOrEqual(glyphs - 0.01);
      }
    });
  }
}
