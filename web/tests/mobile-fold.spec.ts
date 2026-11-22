import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Prototype (Nov 2026): on a phone each criterion card shows its level, band, reading, reason and feedback,
// and folds measured values and evidence behind one disclosure (handoff 03: "summarize first").

async function finishedRound(request: APIRequestContext, outcome: "done" | "partial" = "done") {
  const created = await request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).session_id as string;
  const clip = await request.get("/browser-test/clip");
  const video = { name: "test.webm", mimeType: "video/webm", buffer: await clip.body() };
  // Dev mode has one identity and the credit guard allows 2 waiting rounds per account, so a test running
  // in parallel can hold both places for a moment (429): wait for it to finish, as a user would.
  let status = 0;
  await expect.poll(async () => (status = (await request.post(`/api/sessions/${id}/video`, { multipart: { video } })).status()),
    { intervals: [250, 500, 1000], timeout: 15_000 }).not.toBe(429);
  expect(status).toBe(200);
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/${outcome}`)).ok()).toBeTruthy();
  return id;
}

async function videoTime(page: Page) {
  const video = page.getByLabel("วิดีโอการซ้อม", { exact: true });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((el: HTMLVideoElement) => { el.pause(); el.currentTime = 0; });
  return () => video.evaluate((el: HTMLVideoElement) => el.currentTime);
}

test.use({ viewport: { width: 390, height: 844 } });

test("a phone card keeps level, band and feedback in view and folds values and evidence", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.goto(`/sessions/${id}`);
  await expect(page.locator(".card")).toHaveCount(8);
  for (const card of await page.locator(".card").all()) {
    await expect(card.locator(".level")).toBeVisible();
    await expect(card.getByRole("img", { name: /ระดับ \d จาก 4|วิเคราะห์ไม่ได้/ })).toBeVisible();
    await expect(card.locator(".template")).toBeVisible();
    await expect(card.locator(".card-more")).not.toHaveAttribute("open");
  }
  await expect(page.locator(".evidence").first()).toBeHidden();

  const c2 = page.locator('.card[data-criterion="C2"]');
  const fold = c2.locator(".card-more");
  await expect(c2.locator(".card-more > summary")).toContainText("หัวข้อตามแผน 5 หัวข้อ");
  await c2.getByText("ดูค่าที่วัดและหลักฐาน").click();
  await expect(fold).toHaveAttribute("open", "");
  await expect(c2.locator(".coverage-table")).toBeVisible();
  const now = await videoTime(page);
  await c2.locator(".coverage-table button").first().click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("seeking to a criterion from the timeline opens its fold, also after it was closed", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.goto(`/sessions/${id}`);
  const s3 = page.locator('.card[data-criterion="S3"]');
  const fold = s3.locator(".card-more");
  const timeline = page.getByLabel("แถบเวลาหลักฐานทุกเกณฑ์");
  const now = await videoTime(page);
  await expect(fold).not.toHaveAttribute("open");
  await timeline.getByRole("button", { name: /ไปยังเวลา 0:02\.0 \(S3/ }).last().click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);
  await expect(fold).toHaveAttribute("open", "");
  await expect(s3.locator(".evidence")).toBeVisible();
  await expect(page.locator(".notebook-criteria [aria-live=polite]")).toHaveText(/เปิดรายละเอียดเกณฑ์ S3/);

  await fold.locator("summary").click();
  await expect(fold).not.toHaveAttribute("open");
  await timeline.getByRole("button", { name: /ไปยังเวลา 0:02\.0 \(S3/ }).last().click();
  await expect(fold).toHaveAttribute("open", "");
});

test("a criterion that could not be analysed never shows a level when folded", async ({ page, request }) => {
  const id = await finishedRound(request, "partial");
  await page.goto(`/sessions/${id}`);
  const c2 = page.locator('.card[data-criterion="C2"]');
  await expect(c2.locator(".level")).toHaveText("วิเคราะห์ไม่ได้");
  await expect(c2.locator(".reason")).toContainText("หลักฐานไม่พอ");
  await expect(c2).not.toContainText(/ระดับ \d\/4/);
  await expect(c2.locator(".coverage-table")).toHaveCount(0);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("cards are not folded on a wide screen", async ({ page, request }) => {
    const id = await finishedRound(request);
    await page.goto(`/sessions/${id}`);
    await expect(page.locator(".card")).toHaveCount(8);
    await expect(page.locator(".card-more")).toHaveCount(0);
    await expect(page.locator('.card[data-criterion="C2"] .coverage-table')).toBeVisible();
  });
});
