/**
 * template-augment.spec.ts — #568 段 2/3「テンプレを強化」の GUI 経路（#612 で入口をマスターのメニューへ移した）。
 * 🎨 メニュー「加工する」の「テンプレを強化（3 列・KPI 4 個を追加）…」→ 確認 → 強化済みテンプレが「（強化）」の
 * マスターとして登録・選択され、結果バーが「強化」・レイアウト数 +2・追加レイアウト名を示す。段 3 からは無い構造
 * （N 列・比較・カード 3・KPI 3/4）を全部足すので、2/3 列・比較・KPI を持つ Midnight にはカード 3 枚だけが提案される。
 * #612: 取り込みをしていない内蔵マスターでもメニューから強化できる。元にするレイアウトが無いテンプレでは
 * 理由付きで無効。取り込み結果の帯には強化のボタンが無く、メニューへの案内だけが出る。
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { seedDeck } from "./_seed";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/templates");

const masterButton = (page: Page) => page.getByRole("button", { name: /🎨/ });

// Passed as a buffer with an ASCII name: a non-ASCII file PATH never fires the picker's change event in
// this Playwright/Chromium pair (observed 2026-11-07), while the bytes are what the app reads anyway.
async function importMaster(page: Page, file: string, asName: string) {
  await masterButton(page).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /テンプレートを取り込む/ }).click();
  await (await chooser).setFiles({ name: asName, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: readFileSync(resolve(FIX, file)) });
  await expect(page.getByText("取り込み結果")).toBeVisible({ timeout: 15000 });
}

/** Open the master menu and return its 「テンプレを強化」 item. */
async function augmentItem(page: Page) {
  await masterButton(page).click();
  return page.getByTestId("master-augment");
}

test.describe("テンプレを強化 (#568 / #612 menu entry)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await seedDeck(page);
  });

  test("技術報告: the menu item adds the missing 3-column and 4-KPI layouts after confirmation", async ({ page }) => {
    await importMaster(page, "技術報告_スタンダード水色_全レイアウト見本.pptx", "tech-report.pptx");
    await expect(page.getByText("13 レイアウト")).toBeVisible();
    // the intake bar only points at the menu (no button there any more)
    await expect(page.getByTestId("intake-augment")).toHaveCount(0);
    await expect(page.getByTestId("intake-augment-hint")).toHaveText("🎨 テンプレートのメニューの「テンプレートを強化」で 3 列・KPI 4 個 を追加できます");

    const item = await augmentItem(page);
    await expect(item).toHaveText("🧩テンプレートを強化（3 列・KPI 4 個を追加）…");
    await expect(item).toBeEnabled();

    let confirmText = "";
    page.once("dialog", (d) => { confirmText = d.message(); void d.accept(); });
    await item.click();

    await expect(page.getByText("強化（レイアウト追加）")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("15 レイアウト")).toBeVisible();
    await expect(masterButton(page)).toContainText("（強化）");
    expect(confirmText).toContain("02_本文（1カラム）");
    expect(confirmText).toContain("3 列 16→12pt");
    expect(confirmText).toContain("KPI 4 個 本文 16→12pt");
    expect(confirmText).toContain("既にあるため追加しないもの: 2 列・比較（左右 2 案）・カード 3 枚・KPI 3 個");
    // nothing left to add → no hint in the bar; the detail lists the added layout
    await expect(page.getByTestId("intake-augment-hint")).toHaveCount(0);
    await page.getByRole("button", { name: "詳細 ▾" }).click();
    await expect(page.getByText(/追加したレイアウト: 02_本文（1カラム） \+3Body \/ 02_本文（1カラム） \+4KPI/)).toBeVisible();
    // …and the menu item is disabled, saying so
    const after = await augmentItem(page);
    await expect(after).toBeDisabled();
    await expect(after).toContainText("足りないレイアウトはありません");
  });

  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await importMaster(page, "技術報告_スタンダード水色_全レイアウト見本.pptx", "tech-report.pptx");
    page.once("dialog", (d) => void d.dismiss());
    await (await augmentItem(page)).click();
    await expect(page.getByText("13 レイアウト")).toBeVisible();
    await expect(masterButton(page)).not.toContainText("（強化）");
    await expect(await augmentItem(page)).toBeEnabled();
  });

  test("Midnight (already has 2/3 columns, compare, KPI 3/4): only the 3-card layout is offered", async ({ page }) => {
    await importMaster(page, "Midnight_Executive_30_TemplateOnly.pptx", "midnight.pptx");
    await expect(await augmentItem(page)).toHaveText("🧩テンプレートを強化（カード 3 枚を追加）…");
  });

  test("#612: the built-in master (no intake yet) can be augmented from the menu", async ({ page }) => {
    await expect(page.getByText("取り込み結果")).toHaveCount(0); // nothing imported
    await expect(masterButton(page)).toContainText("技術報告 スタンダード水色");
    const item = await augmentItem(page);
    await expect(item).toHaveText("🧩テンプレートを強化（3 列・KPI 4 個を追加）…");
    page.once("dialog", (d) => void d.accept());
    await item.click();
    await expect(page.getByText("強化（レイアウト追加）")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("15 レイアウト")).toBeVisible();
    await expect(masterButton(page)).toContainText("技術報告 スタンダード水色（強化）");
    // registered: it is in the list and selected (✓)
    await masterButton(page).click();
    await expect(page.getByRole("button", { name: /✓.*（強化）/ })).toBeVisible();
  });

  test("#612: a template with no title + one-body layout disables the item with the reason", async ({ page }) => {
    await importMaster(page, "Dirty_AllBody_TemplateOnly.pptx", "all-body.pptx");
    await expect(page.getByTestId("intake-augment-hint")).toHaveCount(0);
    const item = await augmentItem(page);
    await expect(item).toBeDisabled();
    await expect(item).toContainText("テンプレートの強化はできません: タイトル枠と本文 1 枠を持つレイアウトが無いため、元にするレイアウトを決められません。");
  });
});
