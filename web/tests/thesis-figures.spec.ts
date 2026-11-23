import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, GUEST, finishedRound, newRound, openResult } from "./helpers";

/*
 * Screenshots of the five screens for thesis chapter 4 (sample data from contracts/mocks, not a real rehearsal).
 * Skipped in normal runs. To retake:
 *   PROMPTPRES_FIGURES_DIR=<folder> npx playwright test thesis-figures --project=dev
 */
const OUT = process.env.PROMPTPRES_FIGURES_DIR;
test.skip(!OUT, "set PROMPTPRES_FIGURES_DIR to write the thesis screenshots");

test("thesis chapter 4 screenshots", async ({ page, request }) => {
  mkdirSync(OUT!, { recursive: true });
  const shot = (name: string, fullPage = true) => page.screenshot({ path: join(OUT!, name), fullPage });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/login");
  await expect(page.getByRole("button", { name: GUEST })).toBeVisible();
  await shot("ch4_01_login.png");

  await finishedRound(request, "partial");
  const second = await finishedRound(request);
  await request.post(`/browser-rubric/${second}`);          // sample result shown as rubric v0.9
  await page.goto("/");
  await expect(page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" })).toBeVisible();
  await shot("ch4_02_history_trend.png");

  await page.goto("/new");
  await page.getByRole("button", { name: /^เลือกแม่แบบ/ }).click();
  await page.getByRole("group", { name: "เลือกแม่แบบโครงสร้างการนำเสนอ" }).getByRole("button", { name: /สอบป้องกันโครงงานฉบับสมบูรณ์/ }).click();
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ", exact: true }).click();
  await expect(page.getByLabel("ชื่อหัวข้อที่ 5", { exact: true })).toBeVisible();
  await shot("ch4_03_new_session_topics.png");

  await page.goto(`/sessions/${await newRound(request)}/video`);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(page.getByLabel("ภาพจากกล้อง")).toBeVisible();
  await page.waitForTimeout(3000);                       // let the automatic room checks settle
  await shot("ch4_04_record_checklist.png");

  await openResult(page, second);
  // Wait for the transcript request to settle so the capture never shows its loading text.
  await expect(page.locator("[data-transcript] [role=status]")).toHaveCount(0);
  await page.locator("video").first().evaluate((v: HTMLVideoElement) => v.readyState >= 2 ||
    new Promise((done) => v.addEventListener("loadeddata", done, { once: true })));
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height });
  await shot("ch4_06_result_full.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("ch4_05_result_top.png", false);
});
