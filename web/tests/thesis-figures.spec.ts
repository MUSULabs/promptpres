import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Screenshots of the five screens for thesis chapter 4 (sample data from contracts/mocks, not a real rehearsal).
 * Skipped in normal runs. To retake:
 *   PROMPTPRES_FIGURES_DIR=<folder> npx playwright test thesis-figures --project=dev
 */
const OUT = process.env.PROMPTPRES_FIGURES_DIR;
test.skip(!OUT, "set PROMPTPRES_FIGURES_DIR to write the thesis screenshots");

async function finishedRound(request: APIRequestContext, partial = false) {
  const created = await request.post("/api/sessions", { data: { target_duration_s: 900 } });
  const id = (await created.json()).session_id as string;
  const clip = await (await request.get("/browser-test/clip")).body();
  await request.post(`/api/sessions/${id}/video`, { multipart: { video: { name: "test.webm", mimeType: "video/webm", buffer: clip } } });
  await request.post(`/browser-test/${id}/processing`);
  expect((await request.post(`/browser-test/${id}/${partial ? "partial" : "done"}`)).ok()).toBeTruthy();
  await request.post(`/browser-rubric/${id}`);          // sample result shown as rubric v0.9
  return id;
}

test("thesis chapter 4 screenshots", async ({ page, request }) => {
  mkdirSync(OUT!, { recursive: true });
  const shot = (name: string, fullPage = true) => page.screenshot({ path: join(OUT!, name), fullPage });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/login");
  await expect(page.getByRole("button", { name: /ทดลองใช้งานทันที/ })).toBeVisible();
  await shot("ch4_01_login.png");

  await finishedRound(request, true);
  const second = await finishedRound(request);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" })).toBeVisible();
  await shot("ch4_02_history_trend.png");

  await page.goto("/new");
  const templates = page.getByRole("group", { name: "เลือกแม่แบบโครงสร้างการนำเสนอ" });
  await templates.getByRole("button", { name: /สอบป้องกันโครงงานฉบับสมบูรณ์/ }).click();
  await page.getByRole("button", { name: "เริ่ม", exact: true }).click();
  await expect(page.getByLabel("ชื่อหัวข้อที่ 5", { exact: true })).toBeVisible();
  await shot("ch4_03_new_session_topics.png");

  const created = await request.post("/api/sessions", { data: { target_duration_s: 900 } });
  await page.goto(`/sessions/${(await created.json()).session_id}/video`);
  await expect(page.getByLabel("ภาพจากกล้อง")).toBeVisible();
  await page.waitForTimeout(3000);                       // let the automatic room checks settle
  await shot("ch4_04_record_checklist.png");

  await page.goto(`/sessions/${second}`);
  await expect(page.locator(".card")).toHaveCount(8);
  // Wait for the transcript request to settle so the capture never shows its loading text.
  await expect(page.locator("details.transcript, p:has-text('ไม่มีบทพูดสำหรับรอบนี้')").first()).toBeVisible();
  // Show the first video frame, and size the viewport to the page so the full capture is not clipped.
  await page.locator("video").first().evaluate((v: HTMLVideoElement) => v.readyState >= 2 ||
    new Promise((done) => v.addEventListener("loadeddata", done, { once: true })));
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height });
  await shot("ch4_06_result_full.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("ch4_05_result_top.png", false);
});
