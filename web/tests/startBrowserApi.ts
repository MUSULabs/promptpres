import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

// Two isolated APIs: 18370 = dev mode (no login), 18371 = cloud mode (PROMPTPRES_REQUIRE_LOGIN=1).
async function start(port: number, mode: string[]) {
  const health = `http://127.0.0.1:${port}/browser-test/ready`;
  const instance = crypto.randomUUID();
  const root = await mkdtemp(join(tmpdir(), "promptpres-browser-"));
  const child = spawn("python", ["tests/browser_api.py", root, String(port), ...mode], {
    env: { ...process.env, PROMPTPRES_BROWSER_TEST_INSTANCE: instance },
    stdio: "inherit",
    windowsHide: true,
  });
  let startupError: Error | undefined;
  child.on("error", (error) => { startupError = error; });
  const stopped = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const stop = async () => {
    child.kill();
    await stopped;
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error("The browser test API exited before startup");
      const response = await fetch(health, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
      if (response?.ok && await response.text() === instance) return stop;
      await pause(200);
    }
    throw new Error("Timed out waiting for the isolated browser test API");
  } catch (error) {
    await stop();
    throw error;
  }
}

export default async function startBrowserApi() {
  const open = await start(18370, []);
  let login: () => Promise<void>;
  try {
    login = await start(18371, ["login"]);
  } catch (error) {
    await open();
    throw error;
  }
  return async () => { await login(); await open(); };
}
