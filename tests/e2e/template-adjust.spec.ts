/**
 * template-adjust.spec.ts — #570 段 2「テンプレ調整」を実ブラウザで: マスターメニューの「テンプレ調整」から
 * 操作帯を開き、タイトルのスライダを動かすとメインプレビューのタイトル文字が即座に大きくなること、
 * 適用で「（調整）」マスターが選ばれること、キャンセルで元の大きさに戻ること。
 */
import { test, expect, type Page } from "@playwright/test";
import { seedDeck } from "./_seed";

const TITLE = "移行計画レビュー";
/** Largest rendered px size of the cover title (the main preview; thumbnails render it smaller). */
const titlePx = async (page: Page) =>
  Math.max(...(await page.getByText(TITLE, { exact: true }).evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)))));

async function openAdjust(page: Page) {
  await page.getByRole("button", { name: /🎨/ }).click(); // master picker
  await page.getByRole("button", { name: /テンプレ調整/ }).click();
  const panel = page.getByRole("region", { name: "テンプレ調整" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("Template adjust (#570)", () => {
  test("title slider reflects live in the preview; apply registers an adjusted master", async ({ page }) => {
    await page.goto("/");
    await seedDeck(page);
    const before = await titlePx(page);
    const panel = await openAdjust(page);
    await expect(page.getByRole("button", { name: /🎨/ })).toBeDisabled(); // one template change at a time
    await expect(panel.getByRole("button", { name: "調整を適用" })).toBeDisabled(); // nothing changed yet

    await panel.getByRole("slider", { name: "タイトル" }).fill("150");
    await expect(panel.getByText("150%")).toBeVisible();
    await expect.poll(() => titlePx(page), { timeout: 10_000 }).toBeGreaterThan(before * 1.2);

    await panel.getByRole("button", { name: "調整を適用" }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: /🎨/ })).toContainText("（調整）");
    expect(await titlePx(page)).toBeGreaterThan(before * 1.2);
  });

  test("cancel restores the source template", async ({ page }) => {
    await page.goto("/");
    await seedDeck(page);
    const before = await titlePx(page);
    const name = (await page.getByRole("button", { name: /🎨/ }).textContent()) ?? "";
    const panel = await openAdjust(page);
    await panel.getByRole("slider", { name: "タイトル" }).fill("50");
    await expect.poll(() => titlePx(page), { timeout: 10_000 }).toBeLessThan(before * 0.8);

    await panel.getByRole("button", { name: "キャンセル" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => titlePx(page), { timeout: 10_000 }).toBe(before);
    await expect(page.getByRole("button", { name: /🎨/ })).toHaveText(name);
  });
});
