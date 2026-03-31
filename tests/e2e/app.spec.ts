/**
 * E2E tests for SlideCraft frontend.
 *
 * Tests both Diagram mode and Markdown mode.
 */
import { test, expect } from "@playwright/test";

test.describe("SlideCraft — Diagram Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Switch to Diagram mode
    await page.getByRole("button", { name: /diagram/i }).click();
    // Wait for mode switch + debounced parse (300ms) + Mermaid render
    await page.waitForTimeout(2000);
  });

  test("loads with YAML editor", async ({ page }) => {
    const editorLabel = page.locator("text=YAML Editor");
    await expect(editorLabel).toBeVisible();
  });

  test("diagram mode shows YAML editor and Mermaid preview panel", async ({ page }) => {
    await expect(page.locator("text=YAML Editor")).toBeVisible();
    await expect(page.locator("text=Mermaid Preview")).toBeVisible();
    // StatusBar shows parsed spec info
    await expect(page.locator("text=Ready")).toBeVisible({ timeout: 5000 });
  });

  test("generate button triggers PPTX download", async ({ page }) => {
    const generateBtn = page.getByRole("button", { name: /generate|pptx/i });
    await expect(generateBtn).toBeEnabled({ timeout: 5000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await generateBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  });
});

test.describe("SlideCraft — Markdown Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Default is Markdown mode, but click to be sure
    await page.getByRole("button", { name: /markdown/i }).click();
  });

  test("loads with Markdown editor and Slide Preview", async ({ page }) => {
    const editorLabel = page.locator("text=Markdown Editor");
    await expect(editorLabel).toBeVisible();
    const previewLabel = page.locator("text=Slide Preview");
    await expect(previewLabel).toBeVisible();
  });

  test("shows slide preview cards for sample Markdown", async ({ page }) => {
    // Wait for template load + parse
    await page.waitForTimeout(1000);
    // Should have multiple slide cards (the sample has 4 slides)
    const slideCards = page.locator("[style*='position: relative'][style*='overflow: hidden']");
    await expect(slideCards.first()).toBeVisible({ timeout: 5000 });
    const count = await slideCards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("mode toggle switches between Diagram and Markdown", async ({ page }) => {
    // Should start in Markdown
    await expect(page.locator("text=Markdown Editor")).toBeVisible();

    // Switch to Diagram
    await page.getByRole("button", { name: /diagram/i }).click();
    await expect(page.locator("text=YAML Editor")).toBeVisible();

    // Switch back
    await page.getByRole("button", { name: /markdown/i }).click();
    await expect(page.locator("text=Markdown Editor")).toBeVisible();
  });

  test("toolbar shows template button in Markdown mode", async ({ page }) => {
    const templateBtn = page.getByRole("button", { name: /template/i });
    await expect(templateBtn).toBeVisible();
  });

  test("generate button triggers PPTX download in Markdown mode", async ({ page }) => {
    // Wait for template load + parse
    await page.waitForTimeout(2000);
    const generateBtn = page.getByRole("button", { name: /generate|pptx/i });
    await expect(generateBtn).toBeEnabled({ timeout: 5000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await generateBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  });
});

test.describe("SlideCraft — Common", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("toolbar buttons are present", async ({ page }) => {
    await expect(page.getByRole("button", { name: /open/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /save/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /generate|pptx/i })).toBeVisible();
  });

  test("app title shows SlideCraft", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "SlideCraft" })).toBeVisible();
  });

  test("page does not crash on invalid input", async ({ page }) => {
    const editor = page.locator(".cm-editor .cm-content");
    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("{{invalid");
    await page.waitForTimeout(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
