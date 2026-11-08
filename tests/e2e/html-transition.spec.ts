/**
 * html-transition.spec.ts — e2e (#650): the HTML export's transition is chosen INSIDE the File menu (one row of
 * toggle buttons under 🌐 HTML, no hover flyout), and the exported file carries the chosen transition.
 * Companion to tests/toolbar-html-transition-650.test.tsx (markup) — this proves the real click path.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { seedDeck } from "./_seed";

test.describe("HTML export: transition picked in the File menu (#650)", () => {
  test("default exports 'slide'; picking フェード exports 'fade'", async ({ page }) => {
    await page.goto("/");
    await seedDeck(page);
    await page.waitForTimeout(1500); // let the template + deck settle before export

    const exportHtml = async () => {
      await page.getByRole("button", { name: /ファイル/ }).click();
      const htmlBtn = page.getByRole("button", { name: /HTML/ });
      await expect(htmlBtn).toBeEnabled({ timeout: 10000 });
      return htmlBtn;
    };
    const transitionOf = async (click: () => Promise<void>) => {
      const download = page.waitForEvent("download", { timeout: 25000 });
      await click();
      const html = readFileSync(await (await download).path(), "utf-8");
      return html.match(/<html[^>]*data-transition="([a-z]+)"/)?.[1];
    };

    // 1) Untouched → the default (slide) is pressed and is what gets exported.
    let htmlBtn = await exportHtml();
    const group = page.getByRole("group", { name: "HTML の遷移" });
    await expect(group.getByRole("button", { name: "スライド" })).toHaveAttribute("aria-pressed", "true");
    expect(await transitionOf(() => htmlBtn.click())).toBe("slide");

    // 2) Pick フェード in the same menu (no hover / flyout), then export → fade.
    htmlBtn = await exportHtml();
    await group.getByRole("button", { name: "フェード" }).click();
    await expect(group.getByRole("button", { name: "フェード" })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "スライド" })).toHaveAttribute("aria-pressed", "false");
    expect(await transitionOf(() => htmlBtn.click())).toBe("fade");
  });
});
