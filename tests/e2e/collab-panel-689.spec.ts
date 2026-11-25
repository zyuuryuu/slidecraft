/**
 * collab-panel-689.spec.ts — #689: 協働パネルの下の層「接続の設定」を実ブラウザで。
 * ブラウザ版は協働が使えない（一度もつないでいない）ので、開いた状態で始まる。畳むと登録の手順は消え、
 * 「畳んだ」は記憶されて、ページを読み直しても畳んだまま。開き直すと記憶は消える（ai-settings-fold と同じ規則）。
 * 接続後（協働中・許可したクライアントあり）に畳まれることと、協働中の 1 行は単体テスト
 * （tests/collab-panel-two-layer-689.test.tsx）で固定している（ブラウザ版では協働ホストを起動できない）。
 */
import { test, expect, type Page } from "@playwright/test";
import { seedDeck } from "./_seed";

const CMD = 'input[value="claude mcp add slidecraft -- slidecraft-mcp"]';

async function openCollab(page: Page) {
  await page.getByRole("button", { name: /✨ AI/ }).click();
  await page.getByRole("button", { name: /協働/ }).click();
}

test("#689: the setup fold starts open when never connected, folds on click, and the fold is remembered", async ({ page }) => {
  await page.goto("/");
  await seedDeck(page);
  await openCollab(page);
  const toggle = page.getByTestId("collab-setup-toggle");
  await expect(toggle).toHaveText(/[▸▾]\s*接続の設定$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(CMD)).toBeVisible();
  await expect(page.getByRole("button", { name: /接続テスト/ })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(CMD)).toHaveCount(0);

  await page.reload();
  await openCollab(page);
  await expect(page.getByTestId("collab-setup-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(CMD)).toHaveCount(0);

  await page.getByTestId("collab-setup-toggle").click();
  await expect(page.locator(CMD)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("slidecraft_collab_setup_folded"))).toBeNull();
});
