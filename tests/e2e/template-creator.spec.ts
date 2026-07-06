/**
 * template-creator.spec.ts — the テンプレ作成後続UI (テーマ2 後続): the creation modal's in-modal
 * LIVE preview, layout-subset selection, and custom-layout editor, driven in a real browser against
 * the Vite dev server. Proves the sample deck renders on the draft template inside the modal, the
 * subset toggles gate creation, and adding a custom layout surfaces a showcase slide in the preview.
 */
import { test, expect } from "@playwright/test";

test.describe("Template creator (作成後続UI)", () => {
  test("live preview + layout subset + custom layout showcase", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /🎨/ }).click(); // master picker
    await page.getByRole("button", { name: /テンプレを作成/ }).click();
    const dialog = page.getByRole("dialog", { name: "テンプレを作成" });
    await expect(dialog).toBeVisible();

    // (a) live preview: the sample deck renders as slide cards inside the modal (debounced
    //     writeTemplate → loadTemplate → distill). Same card selector the deck-preview e2e uses.
    await expect(dialog.getByText("プレビュー（サンプル）")).toBeVisible();
    const cards = dialog.locator("[style*='position: relative'][style*='overflow: hidden']");
    await expect(cards.first()).toBeVisible({ timeout: 12000 });
    const baseCount = await cards.count();
    expect(baseCount).toBeGreaterThanOrEqual(3);

    // (b) layout subset: the count label + toggles; deselecting all blocks 生成して適用 never-silently.
    await expect(dialog.getByText(/レイアウト（30\/30/)).toBeVisible();
    await dialog.getByRole("button", { name: "全解除" }).click();
    await expect(dialog.getByText(/レイアウト（0\/30/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /生成して適用/ })).toBeDisabled();
    await dialog.getByRole("button", { name: "全選択" }).click();
    await expect(dialog.getByRole("button", { name: /生成して適用/ })).toBeEnabled();

    // (c) custom layout: adding one appends a showcase slide pinned to it → the preview grows.
    await dialog.getByRole("button", { name: /カスタムレイアウトを追加/ }).click();
    await expect(dialog.getByText(/カスタムレイアウト（1）/)).toBeVisible();
    await expect(async () => {
      expect(await cards.count()).toBeGreaterThan(baseCount);
    }).toPass({ timeout: 12000 });
  });
});
