import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Regressions from the UX audit (Nov 2026): leaving the video step must never drop a recording or an
// unsent clip without asking (handoff 03: "do not silently discard a video").

async function newRound(request: APIRequestContext) {
  const response = await request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).session_id as string;
}

async function keepTracks(page: Page) {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const get = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await get(constraints);
      Object.assign(window, { testTracks: stream.getTracks() });
      return stream;
    };
  });
}

const trackStates = (page: Page) => page.evaluate(() =>
  (window as unknown as { testTracks: MediaStreamTrack[] }).testTracks.map((track) => track.readyState));

async function startRecording(page: Page) {
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await page.getByRole("button", { name: "ติ๊กครบทุกข้อ (ยืนยันพร้อมอัด)" }).click();
  await page.getByLabel("นับถอยหลัง").selectOption("0");
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  await expect(page.locator(".recording-clock")).toHaveText(/0:0[1-9]/);
}

test("leaving with a recorded but unsent clip asks first, and cancelling keeps the clip", async ({ page, request }) => {
  const id = await newRound(request);
  await page.goto("/");                       // arrive inside the app so "back" stays inside it
  await page.locator(`a[href="/sessions/${id}/video"]`).first().click();
  await startRecording(page);
  await page.getByRole("button", { name: "หยุดอัด" }).click();
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();

  await page.getByRole("navigation", { name: "เมนูหลัก" }).getByRole("link", { name: "ประวัติ" }).click();
  const dialog = page.getByRole("dialog", { name: "ออกจากขั้นวิดีโอหรือไม่?" });
  await expect(dialog).toContainText("ยังไม่ได้ส่งวิเคราะห์");
  await expect(dialog.getByRole("button", { name: "ยกเลิก", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The dialog's "close" event (which hands the held navigation back) fires in the next task.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await expect(page).toHaveURL(`/sessions/${id}/video`);
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();

  await page.goBack();                       // the browser's back button is held the same way
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "ออกและทิ้งคลิป" }).click();
  await expect(page).toHaveURL("/");
});

test("leaving mid-recording asks first and then turns the camera off", async ({ page, request }) => {
  const id = await newRound(request);
  await keepTracks(page);
  await page.goto(`/sessions/${id}/video`);
  await startRecording(page);
  await page.getByRole("navigation", { name: "เมนูหลัก" }).getByRole("link", { name: "ประวัติ" }).click();
  const dialog = page.getByRole("dialog", { name: "ออกจากขั้นวิดีโอหรือไม่?" });
  await expect(dialog).toContainText("การอัดที่กำลังทำอยู่จะหยุด");
  await expect(page.locator(".recording-clock")).toBeVisible();      // still recording while asking
  await dialog.getByRole("button", { name: "ออกและทิ้งคลิป" }).click();
  await expect(page).toHaveURL("/");
  await expect.poll(() => trackStates(page)).toEqual(["ended", "ended"]);
});

test("recording again over an unsent clip asks first", async ({ page, request }) => {
  const id = await newRound(request);
  await page.goto(`/sessions/${id}/video`);
  await startRecording(page);
  await page.getByRole("button", { name: "หยุดอัด" }).click();
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  await page.getByRole("button", { name: "เปิดกล้องเพื่ออัดใหม่" }).click();
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "อัดใหม่แทนคลิปเดิมหรือไม่?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await expect(page.locator(".recording-clock")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true })).toBeEnabled();   // old clip kept
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  await dialog.getByRole("button", { name: "อัดใหม่แทนคลิปเดิม" }).click();
  await expect(page.locator(".recording-clock")).toHaveText(/0:0[1-9]/);
});

test("closing the tab with an unsent clip triggers the browser's leave prompt", async ({ page, request }) => {
  const id = await newRound(request);
  await page.goto(`/sessions/${id}/video`);
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  const clip = await request.get("/browser-test/clip");
  await page.locator("input[type=file]").setInputFiles({ name: "test.webm", mimeType: "video/webm", buffer: await clip.body() });
  await expect(page.getByLabel("ตัวอย่างคลิปที่เลือก")).toBeVisible();
  const prompt = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await prompt;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
});

test("a clip that was sent leaves for the result page without asking", async ({ page, request }) => {
  const id = await newRound(request);
  // The upload itself is answered here, so this test takes no place in the analysis queue
  // (dev mode has one identity and the credit guard allows 2 waiting rounds per account).
  await page.route(`**/api/sessions/${id}/uploads`, (route) => route.fulfill({ json: {
    upload_id: "0".repeat(32), url: `/api/test-upload/${id}`, token: "t", chunk_bytes: 8 << 20, chunks: 1 } }));
  await page.route(`**/api/test-upload/${id}/chunks/0`, (route) => route.fulfill({ json: {} }));
  await page.route(`**/api/test-upload/${id}/complete`, (route) => route.fulfill({ json: { session_id: id, status: "queued" } }));
  await page.goto(`/sessions/${id}/video`);
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  const clip = await request.get("/browser-test/clip");
  await page.locator("input[type=file]").setInputFiles({ name: "test.webm", mimeType: "video/webm", buffer: await clip.body() });
  await page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true }).click();
  await expect(page).toHaveURL(`/sessions/${id}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
