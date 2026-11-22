import { defineConfig } from "@playwright/test";

const LOGIN_ORIGIN = "http://127.0.0.1:18371";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/startBrowserApi.ts",
  expect: { timeout: 8_000 },
  reporter: "list",
  // Both test APIs are single processes on SQLite and share one credit guard (2 waiting rounds per account
  // in dev mode). Workers follow spec files, and more than 3 parallel browsers (with fake-camera video
  // encoding) made unrelated tests time out on DB waits, so the suite runs on the 3 workers it was built for.
  workers: 3,
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
