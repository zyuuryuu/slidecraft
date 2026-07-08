/**
 * Shared e2e deck seed. The app starts EMPTY (the default sample deck was removed in v0.2.1), so
 * tests that exercise a populated deck seed one through the real Draft flow. The seed is crafted to
 * satisfy the content assertions: ≥3 slides, slide 2 = agenda (body has 概要/アジェンダ/システム), a cover
 * with content (so a dropped image goes BEHIND), and a long-bullet slide that trips the condense lever
 * (so the review offers an ✨直す AI fix). UI default language is Japanese (i18n).
 */
import { expect, type Page } from "@playwright/test";

export const SEED_MD = `# 移行計画レビュー
> 第2四半期

Category: 経営会議
Date: 2026-07-08

---

# 本日のアジェンダ

- プロジェクトの概要と目的
- 現状分析データの共有
- システム比較と推奨案

---

# 現状分析

- 月間アクティブ率は73パーセント
- 平均レスポンスは3.2秒
- モバイルは非対応

---

# 詳細な考察

- 現行システムは月間アクティブユーザー率が目標を大きく下回っており抜本的な改善が必要である
- 平均レスポンス時間が業界平均の三倍に達しておりユーザー体験を著しく損なっている状況が続いている
- モバイル対応が全くなされておらず外出先での利用ニーズに応えられていない点も大きな課題である

---

# まとめ

- 次のステップを合意する`;

/** Seed a deck via the real Draft flow (Markdown in → スライドにする → Edit). */
export async function seedDeck(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Draft/ }).click();
  const editor = page.locator(".cm-editor .cm-content");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(SEED_MD);
  await page.getByRole("button", { name: /スライドにする/ }).click();
  await expect(page.getByText("スライド", { exact: true })).toBeVisible({ timeout: 8000 }); // back in Edit
}
