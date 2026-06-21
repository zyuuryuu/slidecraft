/**
 * E2E tests for SlideCraft (current UI: Import / Edit sub-modes, template-driven
 * Markdown → slide preview → PPTX). Replaces the stale V1 "Diagram/Markdown mode"
 * specs. Runs against the Vite dev server (playwright.config webServer).
 */
import { test, expect } from "@playwright/test";

test.describe("SlideCraft", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shell: title + core toolbar buttons", async ({ page }) => {
    await expect(page.getByText("SlideCraft").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate PPTX/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Template/ })).toBeVisible();
  });

  test("import mode shows the Markdown editor + slide preview", async ({ page }) => {
    await expect(page.getByText("Markdown Editor")).toBeVisible();
    await expect(page.getByText("Slide Preview")).toBeVisible();
  });

  test("preview renders slide cards for the sample deck", async ({ page }) => {
    await page.waitForTimeout(1500); // template fetch + debounced parse + distill
    const cards = page.locator("[style*='position: relative'][style*='overflow: hidden']");
    await expect(cards.first()).toBeVisible({ timeout: 8000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
  });

  test("Import <-> Edit sub-mode toggle", async ({ page }) => {
    await expect(page.getByText("Markdown Editor")).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByText("Slides", { exact: true })).toBeVisible();
    await expect(page.getByText(/Slide Editor/)).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Markdown Editor")).toBeVisible();
  });

  test("Generate triggers a .pptx download", async ({ page }) => {
    await page.waitForTimeout(2500); // wait for template + deck so Generate enables
    const gen = page.getByRole("button", { name: /Generate PPTX/ });
    await expect(gen).toBeEnabled({ timeout: 10000 });
    const download = page.waitForEvent("download", { timeout: 25000 });
    await gen.click();
    expect((await download).suggestedFilename()).toMatch(/\.pptx$/);
  });

  test("does not crash on invalid editor input", async ({ page }) => {
    const editor = page.locator(".cm-editor .cm-content");
    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("{{invalid");
    await page.waitForTimeout(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
