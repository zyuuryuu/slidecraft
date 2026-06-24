/**
 * E2E tests for SlideCraft. The visual Edit surface is the HOME (deck = source of
 * truth); "Import" opens the one-time "Initialize" modal (Markdown in → 確定 → Edit).
 * Runs against the Vite dev server (playwright.config webServer).
 */
import { test, expect } from "@playwright/test";

test.describe("SlideCraft", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shell: title + core toolbar buttons", async ({ page }) => {
    await expect(page.getByText("SlideCraft").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Export/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Template/ })).toBeVisible();
  });

  test("lands in Edit (the home): slide list + slide editor", async ({ page }) => {
    await expect(page.getByText("Slides", { exact: true })).toBeVisible();
    await expect(page.getByText(/Slide Editor/)).toBeVisible();
  });

  test("Import opens the Initialize modal (Markdown editor + split preview)", async ({ page }) => {
    await page.getByRole("button", { name: /Import/ }).click();
    await expect(page.getByText(/Initialize/)).toBeVisible();
    await expect(page.getByText("Markdown Editor")).toBeVisible();
    await expect(page.getByText(/Slide Preview/)).toBeVisible();
  });

  test("Initialize: 確定 commits and returns to Edit", async ({ page }) => {
    await page.getByRole("button", { name: /Import/ }).click();
    await expect(page.getByText("Markdown Editor")).toBeVisible();
    await page.getByRole("button", { name: /確定/ }).click();
    await expect(page.getByText("Markdown Editor")).toHaveCount(0);
    await expect(page.getByText("Slides", { exact: true })).toBeVisible();
  });

  test("preview renders slide cards for the sample deck", async ({ page }) => {
    await page.getByRole("button", { name: /Import/ }).click();
    await page.waitForTimeout(1500); // serialize + debounced parse + distill
    const cards = page.locator("[style*='position: relative'][style*='overflow: hidden']");
    await expect(cards.first()).toBeVisible({ timeout: 8000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
  });

  test("Export → as PPTX triggers a .pptx download", async ({ page }) => {
    await page.waitForTimeout(2500); // wait for template + deck so PPTX export works
    await page.getByRole("button", { name: /Export/ }).click();
    const pptx = page.getByRole("button", { name: /as PPTX/ });
    await expect(pptx).toBeEnabled({ timeout: 10000 });
    const download = page.waitForEvent("download", { timeout: 25000 });
    await pptx.click();
    expect((await download).suggestedFilename()).toMatch(/\.pptx$/);
  });

  test("まとめて整える: the review bar opens the closed-loop proposal modal", async ({ page }) => {
    // The sample deck has long-bullet (condense) tips → the review bar shows + offers
    // the whole-deck refiner. Clicking it runs the loop and opens the review modal.
    const refineBtn = page.getByRole("button", { name: /まとめて整える/ });
    await expect(refineBtn).toBeVisible({ timeout: 8000 });
    await refineBtn.click();
    await expect(page.getByText(/まとめて整える — 確認/)).toBeVisible({ timeout: 8000 });
    // No provider configured + only condense issues → the deterministic pass applies
    // nothing; the modal says so and offers 閉じる (never silently changes the deck).
    await page.getByRole("button", { name: /閉じる|キャンセル/ }).click();
    await expect(page.getByText(/まとめて整える — 確認/)).toHaveCount(0);
  });

  test("AI Assist hosts the task list (タスク tab)", async ({ page }) => {
    await page.getByRole("button", { name: /AI Assist/ }).click();
    // The panel opens with the generate/edit + タスク tabs; the task tab shows the list.
    await page.getByRole("button", { name: /^タスク/ }).click();
    await expect(page.getByText("まだ AI タスクはありません")).toBeVisible();
  });

  test("AI Assist scope = the slide-list selection (no 対象 toggle)", async ({ page }) => {
    await page.getByRole("button", { name: /AI Assist/ }).click();
    await expect(page.getByText(/編集対象:/)).toBeVisible(); // selection indicator
    await expect(page.getByRole("button", { name: "デッキ全体" })).toHaveCount(0); // toggle removed
    await expect(page.getByRole("button", { name: "このスライド" })).toHaveCount(0);
  });

  test("does not crash on invalid editor input (in the Initialize modal)", async ({ page }) => {
    await page.getByRole("button", { name: /Import/ }).click();
    const editor = page.locator(".cm-editor .cm-content");
    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("{{invalid");
    await page.waitForTimeout(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
