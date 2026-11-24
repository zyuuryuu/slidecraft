/**
 * #724 段 1 PR-B — the top bar's menus / the draft dialog on shadcn/ui (Base UI), checked in a real browser:
 *  - focus trap: Tab / Shift+Tab cycle inside the draft dialog and never reach the app behind it;
 *  - Esc order: a menu opened INSIDE the dialog (🎨) closes first, the next Esc closes the dialog;
 *    a backdrop click does not close the draft (cancel restores the pre-open snapshot = the draft would be lost);
 *  - ⚙ menu: arrow keys move between the items only; Tab reaches the language / theme toggles and keeps the menu open.
 *  - AI settings popover: opening it does not focus the provider <select> — in Chromium ↓ on a focused, closed select
 *    changes its value, so the first arrow press would switch the provider.
 * The jsdom side (Portal, sections / items, Esc / outside click, aria-disabled) is tests/toolbar-overlays-724.test.tsx.
 */
import { test, expect, type Page } from "@playwright/test";

const focusInDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
const focused = (page: Page) => page.evaluate(() => (document.activeElement?.textContent ?? "").trim());

test.describe("#724 overlays (Base UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("draft dialog: Tab / Shift+Tab stay inside (focus trap)", async ({ page }) => {
    await page.getByRole("button", { name: "📝 原稿入力", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await focusInDialog(page)).toBe(true);
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < 12; i++) { // more presses than the dialog has stops → it must wrap
        await page.keyboard.press(key);
        await expect.poll(() => focusInDialog(page), `${key} #${i + 1}`).toBe(true);
      }
    }
  });

  test("draft dialog: Esc closes the 🎨 menu first, then the dialog; a backdrop click closes nothing", async ({ page }) => {
    await page.getByRole("button", { name: "📝 原稿入力", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await page.mouse.click(5, 5); // the backdrop
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /🎨/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape"); // focus is back on 🎨: its tooltip must not take this Esc
    await expect(dialog).toHaveCount(0);
  });

  test("⚙ menu: arrows move between items only; Tab reaches the toggles and keeps the menu open", async ({ page }) => {
    await page.getByTestId("top-bar").getByRole("button", { name: "設定", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    const items = new Set<string>();
    for (let i = 0; i < 4; i++) { // more presses than items → it wraps
      await page.keyboard.press("ArrowDown");
      items.add(await focused(page));
    }
    expect([...items].sort()).toEqual(["? ヘルプ（ドキュメント）", "✨ AI 接続設定…"].sort()); // JA/EN/🌙… never visited
    await page.keyboard.press("Tab");
    expect(await focused(page)).not.toBe("");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("AI settings: ↓ right after ⚙ →「AI 接続設定…」opens it does not change the provider", async ({ page }) => {
    await page.getByTestId("top-bar").getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("menuitem", { name: /AI 接続設定/ }).click();
    const popover = page.getByTestId("ai-settings-popover");
    await expect(popover).toBeVisible();
    const provider = popover.locator("select").first();
    const before = await provider.inputValue();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("[data-testid=ai-settings-popover]"))).toBe(true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await provider.inputValue()).toBe(before);
    await expect(popover).toBeVisible();
  });
});
