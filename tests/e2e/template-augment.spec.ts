/**
 * template-augment.spec.ts — #568 段 2「テンプレを強化」の GUI 経路。
 * マスターを取り込む → 取り込み結果バーに「テンプレを強化（3 列を追加）」→ 確認 → 強化済みテンプレが
 * 適用され、結果バーが「強化」・レイアウト数 +1・追加レイアウト名を示す。3 列を持つテンプレでは出ない。
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { seedDeck } from "./_seed";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/templates");

// Passed as a buffer with an ASCII name: a non-ASCII file PATH never fires the picker's change event in
// this Playwright/Chromium pair (observed 2026-11-07), while the bytes are what the app reads anyway.
async function importMaster(page: Page, file: string, asName: string) {
  await page.getByRole("button", { name: /🎨/ }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /マスターを取り込む/ }).click();
  await (await chooser).setFiles({ name: asName, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: readFileSync(resolve(FIX, file)) });
  await expect(page.getByText("取り込み結果")).toBeVisible({ timeout: 15000 });
}

test.describe("テンプレを強化 (#568)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await seedDeck(page);
  });

  test("技術報告: the button adds a 3-column layout after confirmation", async ({ page }) => {
    await importMaster(page, "技術報告_スタンダード水色_全レイアウト見本.pptx", "tech-report.pptx");
    await expect(page.getByText("13 レイアウト")).toBeVisible();
    const btn = page.getByTestId("intake-augment");
    await expect(btn).toHaveText("テンプレを強化（3 列を追加）");

    let confirmText = "";
    page.once("dialog", (d) => { confirmText = d.message(); void d.accept(); });
    await btn.click();

    await expect(page.getByText("強化（レイアウト追加）")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("14 レイアウト")).toBeVisible();
    expect(confirmText).toContain("02_本文（1カラム）");
    expect(confirmText).toContain("16→12pt");
    // nothing left to add → the button is gone; the detail lists the added layout
    await expect(page.getByTestId("intake-augment")).toHaveCount(0);
    await page.getByRole("button", { name: "詳細 ▾" }).click();
    await expect(page.getByText(/追加したレイアウト: 02_本文（1カラム） \+3Body/)).toBeVisible();
  });

  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await importMaster(page, "技術報告_スタンダード水色_全レイアウト見本.pptx", "tech-report.pptx");
    page.once("dialog", (d) => void d.dismiss());
    await page.getByTestId("intake-augment").click();
    await expect(page.getByText("13 レイアウト")).toBeVisible();
    await expect(page.getByTestId("intake-augment")).toBeVisible();
  });

  test("Midnight (already has 2/3 columns): no button", async ({ page }) => {
    await importMaster(page, "Midnight_Executive_30_TemplateOnly.pptx", "midnight.pptx");
    await expect(page.getByTestId("intake-augment")).toHaveCount(0);
  });
});
