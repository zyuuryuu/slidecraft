/**
 * notice-slot.spec.ts — #613 受け入れ基準を実ブラウザで: 更新通知・取り込み結果・テンプレ調整が同時に起きても、
 * ツールバーの下に出る帯は 1 本だけで、本文の上端は帯 1 本分しか下がらない。隠れた帯の数は「+N」のバッジで示し、
 * 前の帯が終われば次の帯が出る（テンプレ調整 ＞ 取り込み ＞ 更新通知）。
 * 更新通知は GitHub Releases への問い合わせを差し替えて出す（新しい版 v99.0.0 があることにする）。
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { seedDeck } from "./_seed";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/templates");
const UPDATE_TEXT = "新しいバージョン（v99.0.0）が利用可能です。";
const masterButton = (page: Page) => page.getByRole("button", { name: /🎨/ });

/** Top/bottom (px) of the toolbar row, the notice slot and the edit body (the slot's neighbours). */
async function geometry(page: Page) {
  const slot = page.getByTestId("notice-slot");
  const box = async (xpath: string) => (await slot.locator(xpath).boundingBox())!;
  const toolbar = await box("xpath=preceding-sibling::div[1]");
  const s = (await slot.boundingBox())!;
  const band = await box("xpath=div[1]/*[1]"); // the one band component inside the slot
  const body = await box("xpath=following-sibling::div[1]");
  return { toolbarBottom: toolbar.y + toolbar.height, slotTop: s.y, slotH: s.height, bandH: band.height, bodyTop: body.y };
}

/** The body starts exactly one band below the toolbar: no second band is stacked in between. */
async function expectOneBandDrop(page: Page) {
  const g = await geometry(page);
  expect(g.slotTop).toBeCloseTo(g.toolbarBottom, 0);
  expect(g.slotH).toBeCloseTo(g.bandH, 0);
  expect(g.bodyTop - g.toolbarBottom).toBeCloseTo(g.bandH, 0);
}

test("#613: three simultaneous notices → one band, the body drops by one band, the rest wait behind a badge", async ({ page }) => {
  await page.route("https://api.github.com/repos/zyuuryuu/slidecraft/releases/latest", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag_name: "v99.0.0", assets: [] }) }),
  );
  await page.goto("/");
  await seedDeck(page);
  const slot = page.getByTestId("notice-slot");
  const badge = page.getByTestId("notice-slot-hidden");

  // 1. update notice only
  await expect(page.getByText(UPDATE_TEXT)).toBeVisible();
  await expect(slot).toHaveAttribute("data-notice", "update");
  await expect(badge).toHaveCount(0);
  await expectOneBandDrop(page);

  // 2. + intake result → the intake band replaces it; the update waits (+1)
  await masterButton(page).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /テンプレートを取り込む/ }).click();
  await (await chooser).setFiles({
    name: "tech-report.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: readFileSync(resolve(FIX, "技術報告_スタンダード水色_全レイアウト見本.pptx")),
  });
  await expect(page.getByText("取り込み結果")).toBeVisible({ timeout: 15000 });
  await expect(slot).toHaveAttribute("data-notice", "intake");
  await expect(page.getByText(UPDATE_TEXT)).toHaveCount(0);
  await expect(badge).toHaveText("+1");
  await expectOneBandDrop(page);

  // 3. + template adjust → all three at once: only the adjust band shows (+2)
  await masterButton(page).click();
  await page.getByRole("button", { name: /テンプレート調整/ }).click();
  const panel = page.getByRole("region", { name: "テンプレート調整" });
  await expect(panel).toBeVisible();
  await expect(slot).toHaveAttribute("data-notice", "adjust");
  await expect(page.getByText("取り込み結果")).toHaveCount(0);
  await expect(page.getByText(UPDATE_TEXT)).toHaveCount(0);
  await expect(badge).toHaveText("+2");
  await expect(badge).toHaveAttribute("title", "ほかに 2 件の通知があります（取り込み・更新のお知らせ）。いま出ている帯が終わると表示されます。");
  await expectOneBandDrop(page);

  // 4. the hidden ones come back in order as each ends
  await panel.getByRole("button", { name: "キャンセル" }).click();
  await expect(slot).toHaveAttribute("data-notice", "intake");
  await expect(badge).toHaveText("+1");
  await slot.getByTitle("閉じる").click(); // the intake band's × (the only band in the slot)
  await expect(slot).toHaveAttribute("data-notice", "update");
  await expect(page.getByText(UPDATE_TEXT)).toBeVisible();
  await expect(badge).toHaveCount(0);
});
