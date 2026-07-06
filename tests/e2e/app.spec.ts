/**
 * E2E tests for SlideCraft. The visual Edit surface is the HOME (deck = source of
 * truth); "Draft" opens the one-time modal (Markdown in → スライドにする → Edit).
 * Runs against the Vite dev server (playwright.config webServer).
 */
import { test, expect } from "@playwright/test";

test.describe("SlideCraft", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shell: title + core toolbar buttons", async ({ page }) => {
    await expect(page.getByText("SlideCraft").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /ファイル/ })).toBeVisible();
    // The template button is now the master picker, labelled with the current master (🎨 …).
    await expect(page.getByRole("button", { name: /🎨/ })).toBeVisible();
  });

  test("lands in Edit (the home): slide list + slide editor", async ({ page }) => {
    await expect(page.getByText("Slides", { exact: true })).toBeVisible();
    await expect(page.getByText(/Slide Editor/)).toBeVisible();
    await expect(page.locator(".cursor-col-resize")).toHaveCount(2); // Slides|Editor AND Editor|Preview dividers
  });

  test("Draft opens the modal (Markdown editor + split preview)", async ({ page }) => {
    await page.getByRole("button", { name: /Draft/ }).click();
    await expect(page.getByText("Markdown Editor")).toBeVisible();
    await expect(page.getByText(/Slide Preview/)).toBeVisible();
    await expect(page.getByRole("button", { name: /スライドにする/ })).toBeVisible();
  });

  test("Draft: スライドにする commits and returns to Edit", async ({ page }) => {
    await page.getByRole("button", { name: /Draft/ }).click();
    await expect(page.getByText("Markdown Editor")).toBeVisible();
    await page.getByRole("button", { name: /スライドにする/ }).click();
    await expect(page.getByText("Markdown Editor")).toHaveCount(0);
    await expect(page.getByText("Slides", { exact: true })).toBeVisible();
  });

  test("preview renders slide cards for the sample deck", async ({ page }) => {
    await page.getByRole("button", { name: /Draft/ }).click();
    await page.waitForTimeout(1500); // serialize + debounced parse + distill
    const cards = page.locator("[style*='position: relative'][style*='overflow: hidden']");
    await expect(cards.first()).toBeVisible({ timeout: 8000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
  });

  test("ファイル → PPTX triggers a .pptx download", async ({ page }) => {
    await page.waitForTimeout(2500); // wait for template + deck so PPTX export works
    await page.getByRole("button", { name: /ファイル/ }).click();
    await expect(page.getByText(/プロジェクトを開く/)).toBeVisible(); // .slidecraft entry present
    const pptx = page.getByRole("button", { name: /PPTX/ });
    await expect(pptx).toBeEnabled({ timeout: 10000 });
    const download = page.waitForEvent("download", { timeout: 25000 });
    await pptx.click();
    expect((await download).suggestedFilename()).toMatch(/\.pptx$/);
  });

  test("✨直す: hands an AI issue off to AI Assist with a pre-filled prompt", async ({ page }) => {
    // The review summary expands to the list; an AI-needing issue offers ✨直す → opens
    // AI Assist pre-filled (select slide + prompt), never a silent auto-AI.
    await page.getByRole("button", { name: /詳細を見る/ }).click(); // expand the review list
    await page.getByRole("button", { name: "✨直す" }).first().click();
    await expect(page.getByText(/編集対象:/)).toBeVisible({ timeout: 8000 });
    await expect(page.getByPlaceholder(/このスライドへの指示/)).toHaveValue(/要約|キーフレーズ|タイトル|簡潔/);
  });

  test("AI Assist hosts the task list (タスク tab)", async ({ page }) => {
    await page.getByRole("button", { name: /✨ AI/ }).click();
    // The panel opens with the generate/edit + タスク tabs; the task tab shows the list.
    await page.getByRole("button", { name: /^タスク/ }).click();
    await expect(page.getByText("まだ AI タスクはありません")).toBeVisible();
  });

  test("AI Assist scope = the slide-list selection (no 対象 toggle)", async ({ page }) => {
    await page.getByRole("button", { name: /✨ AI/ }).click();
    await expect(page.getByText(/編集対象:/)).toBeVisible(); // selection indicator
    await expect(page.getByRole("button", { name: "デッキ全体" })).toHaveCount(0); // toggle removed
    await expect(page.getByRole("button", { name: "このスライド" })).toHaveCount(0);
  });

  test("AI Assist: the instruction box collapses (freeing the preview) and re-expands", async ({ page }) => {
    await page.getByRole("button", { name: /✨ AI/ }).click();
    const box = page.getByPlaceholder(/このスライドへの指示/);
    await expect(box).toBeVisible(); // expanded by default
    await page.getByTitle(/指示欄をたたむ/).click(); // chevron ▾ → fold
    await expect(box).toHaveCount(0); // textarea removed → room goes to the preview
    await page.getByTitle("指示欄を開く").click(); // chevron ▸ → unfold
    await expect(box).toBeVisible();
  });

  test("does not crash on invalid editor input (in the Draft modal)", async ({ page }) => {
    await page.getByRole("button", { name: /Draft/ }).click();
    const editor = page.locator(".cm-editor .cm-content");
    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("{{invalid");
    await page.waitForTimeout(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Slide Editor: Layout is collapsed by default and expands on click", async ({ page }) => {
    await page.waitForTimeout(1500); // deck + slide editor
    // The Layout row is a toggle showing the ACTIVE layout; its picker is hidden until expanded.
    const layoutToggle = page.getByRole("button", { name: /Layout/ });
    await expect(layoutToggle).toBeVisible();
    const picker = page.locator('select:has(option[value="auto"])'); // the layout <select>
    await expect(picker).toHaveCount(0); // collapsed by default → picker not rendered
    await layoutToggle.click();
    await expect(picker).toBeVisible(); // expanded → the picker appears
  });

  test("slide list: add / duplicate / delete change the slide count", async ({ page }) => {
    await page.waitForTimeout(1500); // sample deck
    const del = page.getByTitle("このスライドを削除"); // one per slide (hover-revealed) = a count proxy
    const before = await del.count();
    expect(before).toBeGreaterThanOrEqual(3);
    await page.getByTitle(/スライドを追加/).click(); // ＋ in the "Slides" header band
    await expect(del).toHaveCount(before + 1);
    await page.locator(".group").first().hover();
    await page.getByTitle("このスライドを複製").first().click();
    await expect(del).toHaveCount(before + 2);
    await page.locator(".group").first().hover();
    await del.first().click();
    await expect(del).toHaveCount(before + 1);
  });

  test("slide list: drag-reorder changes the slide order", async ({ page }) => {
    await page.waitForTimeout(1500); // sample deck
    const drags = page.getByTitle("ドラッグで並べ替え"); // one draggable wrapper per slide
    expect(await drags.count()).toBeGreaterThanOrEqual(3);
    const firstBefore = (await drags.nth(0).textContent())?.trim();
    // POINTER-based drag (native HTML5 DnD is unreliable in Tauri webviews): press on slide 1, move over
    // slide 3 in steps (past the 5px threshold → pointermove fires), release → the drop applies onMove.
    const src = (await drags.nth(0).boundingBox())!;
    const dst = (await drags.nth(2).boundingBox())!;
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(async () => {
      const firstAfter = (await page.getByTitle("ドラッグで並べ替え").nth(0).textContent())?.trim();
      expect(firstAfter).not.toBe(firstBefore); // the first slot now shows a different slide
    }).toPass({ timeout: 3000 });
  });

  test("image: pasting an image inserts it onto the current slide (renders as a data <img>)", async ({ page }) => {
    await page.waitForTimeout(1500); // sample deck
    await page.evaluate(() => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "x.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("image: dropping an image file inserts it onto the current slide (browser path)", async ({ page }) => {
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "x.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/🖼 画像/)).toBeVisible(); // the Slide Editor form reflects the image
    // The active (cover) slide already has content → the image goes BEHIND it (最背面), non-destructively.
    await expect(page.getByText(/最背面レイヤー/)).toBeVisible();
  });

  test("image: dropping onto a slide with body text keeps the text (behind, non-destructive)", async ({ page }) => {
    await page.waitForTimeout(1500);
    await page.getByTitle("ドラッグで並べ替え").nth(1).click(); // select slide 2 (アジェンダ — has bullet body)
    const body = page.locator("textarea").first(); // BODY.CENTER (idx 1) is the first field
    await expect(body).toHaveValue(/概要|アジェンダ|システム/, { timeout: 5000 });
    const before = await body.inputValue();
    await page.evaluate(() => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "x.png", { type: "image/png" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.getByText(/最背面レイヤー/)).toBeVisible(); // it went BEHIND, as a layer
    await expect(body).toHaveValue(before); // …and the bullets are untouched (not replaced by the image)
  });

  test("image: resizing a body-figure image via a corner handle shrinks the box (pointer)", async ({ page }) => {
    await page.waitForTimeout(1500);
    await page.getByTitle(/スライドを追加/).click(); // a BLANK slide (becomes active) → a dropped image is a body figure
    await page.evaluate(() => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "x.png", { type: "image/png" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    // A body-figure image shows resize handles IN FRONT (grabbable). Grab the box = a handle's parent.
    const handle = page.locator('[data-image-handle="se"]');
    await expect(handle).toBeVisible({ timeout: 5000 });
    const box = handle.locator("xpath=..");
    const before = (await box.boundingBox())!;
    // POINTER drag the SE handle INWARD (native HTML5 DnD is unreliable in Tauri webviews) → the box
    // shrinks from the top-left anchor. Shrinking is unconstrained (unlike move), so this is robust.
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 100, hb.y - 70, { steps: 12 });
    await page.mouse.up();
    await expect(async () => {
      const after = (await box.boundingBox())!;
      expect(after.width).toBeLessThan(before.width - 5); // the image shrank
    }).toPass({ timeout: 3000 });
  });

  test("theme toggle switches the palette and persists across reload", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark"); // default
    await page.getByTitle("Light").click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.reload(); // persisted (applied before first paint → no flash)
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.getByTitle(/Modern/).click();
    await expect(html).toHaveAttribute("data-theme", "modern");
  });
});
