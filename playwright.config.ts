import { defineConfig, devices } from "@playwright/test";

process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"]
  .filter(Boolean)
  .join(",");
process.env.no_proxy = process.env.NO_PROXY;

const port = Number(process.env.PLAYWRIGHT_PORT ?? 12741);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  `npx next dev -H 127.0.0.1 -p ${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["json", { outputFile: "reports/playwright/results.json" }],
      ]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    launchOptions: {
      args: ["--no-proxy-server"],
    },
    testIdAttribute: "data-testid",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: webServerCommand,
        env: {
          AI_MOCK_MODE: process.env.AI_MOCK_MODE ?? "true",
          BRANCHMIND_PROJECTS_BACKEND:
            process.env.BRANCHMIND_PROJECTS_BACKEND ?? "file",
          DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "playwright-mock-key",
          DEEPSEEK_MOCK_STREAM_DELAY_MS:
            process.env.DEEPSEEK_MOCK_STREAM_DELAY_MS ?? "80",
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: baseURL,
      },
});
