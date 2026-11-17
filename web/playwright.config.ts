import { defineConfig } from "@playwright/test";

const LOGIN_ORIGIN = "http://127.0.0.1:18371";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/startBrowserApi.ts",
  expect: { timeout: 8_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:18370",
    channel: process.env.PROMPTPRES_TEST_BROWSER_CHANNEL || undefined,
    launchOptions: { args: ["--no-proxy-server", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    reducedMotion: "reduce",
    permissions: ["camera", "microphone"],
  },
  projects: [
    { name: "dev", testIgnore: /auth-required/ },
    // Cloud mode (login required). Non-GET calls from the test's request client must carry the public Origin.
    { name: "login-required", testMatch: /auth-required/, use: { baseURL: LOGIN_ORIGIN, extraHTTPHeaders: { Origin: LOGIN_ORIGIN } } },
  ],
});
