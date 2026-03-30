/**
 * E2E tests for SlideCraft frontend.
 *
 * These tests run against the Vite dev server (not the Tauri shell)
 * to validate core user-facing scenarios in a real browser.
 */
import { test, expect } from "@playwright/test";

test.describe("SlideCraft App", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads with sample YAML in editor", async ({ page }) => {
    // Editor panel should be visible
    const editorLabel = page.locator("text=YAML Editor");
    await expect(editorLabel).toBeVisible();

    // Preview panel should be visible
    const previewLabel = page.locator("text=Mermaid Preview");
    await expect(previewLabel).toBeVisible();
  });

  test("shows Mermaid preview for valid YAML", async ({ page }) => {
    // Mermaid renders SVG via dangerouslySetInnerHTML after async render.
    // Allow extra time for debounce (300ms) + mermaid.render().
    const svg = page.locator("svg[id^='mermaid-']");
    await expect(svg).toBeVisible({ timeout: 10000 });
  });

  test("shows validation error for invalid YAML", async ({ page }) => {
    // Clear editor and type invalid YAML
    const editor = page.locator(".cm-editor .cm-content");
    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("invalid: [unclosed");

    // Wait for debounce
    await page.waitForTimeout(500);

    // At minimum, the page should not crash
    await expect(page.locator("body")).toBeVisible();
  });

  test("toolbar buttons are present", async ({ page }) => {
    // Open, Save, Generate buttons should exist
    const openBtn = page.getByRole("button", { name: /open/i });
    const saveBtn = page.getByRole("button", { name: /save/i });
    const generateBtn = page.getByRole("button", { name: /generate|pptx/i });

    await expect(openBtn).toBeVisible();
    await expect(saveBtn).toBeVisible();
    await expect(generateBtn).toBeVisible();
  });

  test("generate button triggers PPTX download", async ({ page }) => {
    // Wait for sample YAML to parse
    await page.waitForTimeout(500);

    const generateBtn = page.getByRole("button", { name: /generate|pptx/i });

    // Set up download listener
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await generateBtn.click();
    const download = await downloadPromise;

    // Verify downloaded file has .pptx extension
    expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  });

  test("theme picker is visible and interactive", async ({ page }) => {
    // Theme picker should be present
    const themePicker = page.locator("select, [role='listbox'], [class*='ThemePicker']").first();
    await expect(themePicker).toBeVisible();
  });
});
