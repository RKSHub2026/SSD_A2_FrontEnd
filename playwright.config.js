import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (npm run e2e). Playwright starts test/e2e/serve.js, which
 * builds a fresh ridesync_e2e_test PostgreSQL database from sql/ + the test
 * fixtures and serves the app on port 4100 (your demo data is not touched).
 * MongoDB screens use your seeded ridesync_db; their tests are skipped when
 * MongoDB is not running.
 * To test an already running server instead: E2E_BASE_URL=http://... npm run e2e
 */
const port = Number(process.env.E2E_PORT ?? 4100);
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: external ?? `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, grepInvert: /@phone/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: external
    ? undefined
    : {
        command: "node --env-file-if-exists=.env test/e2e/serve.js",
        url: `http://127.0.0.1:${port}/`,
        env: { E2E_PORT: String(port) },
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
      },
});
