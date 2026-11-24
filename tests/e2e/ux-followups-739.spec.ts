/**
 * #739-1 — BarTip in a real browser: after a menu closes because the keyboard focus LEFT it (Tab past its last row),
 * coming back to the trigger with Shift+Tab shows the trigger's tooltip again. Only the focus that the menu itself hands
 * back to the trigger (Esc / an item / an outside click on Base UI's backdrop) skips the tooltip — that case is
 * tests/e2e/overlays-724.spec.ts ("Esc closes the 🎨 menu first, then the dialog").
 * The jsdom side is tests/ux-followups-739.test.tsx.
 */
import { test, expect, type Page } from "@playwright/test";

const activeName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? (document.activeElement?.textContent ?? "").trim());
/** ⚙'s own tooltip (a closing tooltip of a button passed on the way may still be in the DOM). */
const gearTip = (page: Page) => page.locator("[data-slot=tooltip-content]:not([data-closed])", { hasText: "設定（" });

test("⚙ menu: Tab out of the menu, Shift+Tab back to ⚙ → its tooltip shows", async ({ page }) => {
  await page.goto("/");
  const gear = page.getByTestId("top-bar").getByRole("button", { name: "設定", exact: true });
  await gear.focus();
  await expect(gearTip(page)).toBeVisible(); // self-check: keyboard focus on a closed trigger opens it
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  for (let i = 0; i < 12 && (await page.getByRole("menu").count()); i++) await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await activeName(page)).not.toBe("設定"); // the focus went on past the trigger
  for (let i = 0; i < 12 && (await activeName(page)) !== "設定"; i++) await page.keyboard.press("Shift+Tab");
  expect(await activeName(page)).toBe("設定");
  await expect(gearTip(page)).toBeVisible();
});
