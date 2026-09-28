import { defineConfig, devices } from "@playwright/test";
import { ONBOARDING_SKIP_KEY } from "./src/components/onboarding-state";

const BASE_URL = "http://localhost:5173";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // CI: `list` streams per-test progress into the job log (a hang is visible, #334), `github`
  // annotates failures, `html` writes playwright-report/ for the workflow's upload step.
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : "list",
  timeout: 30_000,
  // Whole-run budget below the CI job's `timeout-minutes: 20`, so a systemic hang ends as a
  // Playwright FAILURE (with report) instead of a silent job `cancelled` (#334). A healthy run is ~1 min.
  globalTimeout: process.env.CI ? 15 * 60_000 : 0,

  use: {
    baseURL: BASE_URL,
    // Every test starts from a fresh browser profile, so the first-run onboarding panel (#259) —
    // a full-screen overlay — would intercept every click (the #334 hang). Start with it skipped,
    // exactly as a returning user who checked "次回以降表示しない".
    storageState: {
      cookies: [],
      origins: [{ origin: BASE_URL, localStorage: [{ name: ONBOARDING_SKIP_KEY, value: "1" }] }],
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
