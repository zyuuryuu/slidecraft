/**
 * html-print.spec.ts — e2e: the exported HTML's REAL print output (verify-real-output).
 *
 * Exports a standalone .html from the running app, then renders it through Chromium's print
 * engine (page.pdf) and asserts the shell's print CSS paginates one LANDSCAPE page per slide.
 * Companion to the string-level html-export-shell.test.ts (which locks the CSS text): this
 * proves the CSS actually WORKS end-to-end (the "all slides on one sheet" clip bug would show
 * here as page count 1). Runs against the Vite dev server (playwright.config webServer).
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { seedDeck } from "./_seed";

/** Count pages in a Chromium-produced PDF by its page-tree LEAVES (/Type /Page, not /Pages).
 *  Robust for page.pdf()'s uncompressed output; the /Pages tree is BALANCED (intermediate nodes
 *  each carry their own /Count, e.g. 8,8,8,6 for 30 pages), so parsing /Count hits an intermediate
 *  node, not the total. Falls back to the largest /Count (the root's total) if leaves aren't plain. */
function countPdfPages(pdf: Buffer): number {
  const s = pdf.toString("latin1");
  const leaves = s.match(/\/Type\s*\/Page\b/g); // \b excludes /Pages (e↔s is not a boundary)
  if (leaves && leaves.length > 0) return leaves.length;
  const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  throw new Error("could not determine PDF page count (unexpected PDF structure)");
}

test.describe("HTML export: real print output", () => {
  test("exports .html whose print CSS renders one landscape page per slide", async ({ page }) => {
    await page.goto("/");
    await seedDeck(page); // the app starts empty (v0.2.1) — seed a deck so HTML export is enabled
    await page.waitForTimeout(1500); // let the template + deck settle before export

    // Export via the real File menu — clicking 🌐 HTML exports with the default ('slide') transition.
    await page.getByRole("button", { name: /ファイル/ }).click();
    await expect(page.getByText(/プロジェクトを開く/)).toBeVisible();
    const htmlBtn = page.getByRole("button", { name: /HTML/ });
    await expect(htmlBtn).toBeEnabled({ timeout: 10000 });
    const download = page.waitForEvent("download", { timeout: 25000 });
    await htmlBtn.click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.html$/);

    const html = readFileSync(await file.path(), "utf-8");

    // Print CSS is wired: @media print, background-forced print, one-slide-per-page break, landscape @page.
    expect(html).toContain("@media print{");
    expect(html).toContain("-webkit-print-color-adjust:exact");
    expect(html).toMatch(/break-after:page/);
    const pageRule = html.match(/@page\{size:(\d+)px (\d+)px;margin:0\}/);
    expect(pageRule).toBeTruthy();
    const [, w, h] = pageRule!;
    expect(Number(w)).toBeGreaterThan(Number(h)); // explicit landscape shape (16:9)

    // Render the REAL exported HTML through Chromium's print engine (headless only).
    const pdfPage = await page.context().newPage();
    await pdfPage.setContent(html, { waitUntil: "load" });
    const slideCount = await pdfPage.locator(".slide").count(); // the print unit, via the real selector
    expect(slideCount).toBeGreaterThanOrEqual(3);
    const pdf = await pdfPage.pdf({ printBackground: true, preferCSSPageSize: true });
    await pdfPage.close();

    // Valid, non-trivial PDF (the print pipeline ran end-to-end without breaking).
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Pagination produced exactly one page per slide (not the all-on-one-sheet clip bug).
    expect(countPdfPages(pdf)).toBe(slideCount);
  });
});
