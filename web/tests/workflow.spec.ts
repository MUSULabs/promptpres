import { test, expect, type APIRequestContext } from "@playwright/test";

const target = { target_duration_s: 900 };
const sample = async (request: APIRequestContext) => {
  const response = await request.get("/browser-test/clip");
  expect(response.ok()).toBeTruthy();
  return { name: "test.webm", mimeType: "video/webm", buffer: await response.body() };
};

async function newRound(request: APIRequestContext) {
  const response = await request.post("/api/sessions", { data: target });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).session_id as string;
}

test("leaving setup during confirm never pulls the user back", async ({ page }) => {
  await page.goto("/new");
  await page.getByRole("button", { name: "เริ่ม", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มหัวข้อเอง" }).click();
  for (let i = 1; i <= 3; i++) await page.getByLabel(`ชื่อหัวข้อที่ ${i}`, { exact: true }).fill(`หัวข้อ ${i}`);

  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let markSaved!: () => void;
  const saved = new Promise<void>((resolve) => { markSaved = resolve; });
  await page.route(/\/api\/sessions\/[^/]+\/topics$/, async (route) => {
    const response = await route.fetch();
    markSaved();
    await waiting;
    await route.fulfill({ response }).catch(() => undefined);
  });
  const confirmStarted = page.waitForRequest((req) => req.method() === "PUT" && req.url().endsWith("/topics"));
  await page.getByRole("button", { name: "ยืนยันหัวข้อ แล้วไปขั้นวิดีโอ" }).click();
  try {
    const req = await confirmStarted;
    await saved;
    const cancelled = page.waitForEvent("requestfailed", { predicate: (failed) => failed === req });
    await page.getByRole("navigation", { name: "เมนูหลัก" }).getByRole("link", { name: "ประวัติ" }).click();
    await cancelled;
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "ประวัติการซ้อม", exact: true })).toBeVisible();
});

test("malformed upload response can be retried and result evidence seeks", async ({ page, request }) => {
  const id = await newRound(request);
  await page.goto(`/sessions/${id}/video`);
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  const clip = await sample(request);
  await page.locator("input[type=file]").setInputFiles(clip);
  await page.route(`**/api/sessions/${id}/uploads/*/complete`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>invalid response</h1>" }), { times: 1 });
  const send = page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true });
  await send.click();
  await expect(page.getByRole("alert")).toContainText("เซิร์ฟเวอร์ตอบกลับในรูปแบบที่อ่านไม่ได้");
  await expect(send).toBeEnabled();
  await expect(page.getByLabel("ตัวอย่างคลิปที่เลือก")).toBeVisible();
  await send.click();
  await expect(page.getByRole("heading", { name: "อยู่ในคิว รอเครื่องวิเคราะห์" })).toBeVisible();
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "กำลังวิเคราะห์วิดีโอการซ้อม" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  expect((await request.post(`/browser-test/${id}/done`)).ok()).toBeTruthy();
  await expect(page.locator(".card")).toHaveCount(8, { timeout: 8_000 });
  await expect(page.locator(".result-times dd")).toHaveText(["0:05.0", "0:03.0", "15:00.0"]);
  const video = page.getByLabel("วิดีโอการซ้อม", { exact: true });
  const time = page.getByRole("button", { name: "ไปยังเวลา 0:02.0 – 0:03.0", exact: true }).first();
  await time.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("table", { name: "หัวข้อตามแผน" })).toBeVisible();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("partial C2 does not display coverage labels from stored topic rows", async ({ page, request }) => {
  const id = await newRound(request);
  const clip = await sample(request);
  expect((await request.post(`/api/sessions/${id}/video`, { multipart: { video: clip } })).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/partial`)).ok()).toBeTruthy();
  await page.goto(`/sessions/${id}`);
  await expect(page.locator(".card-wide")).toContainText("วิเคราะห์ไม่ได้");
  await expect(page.getByRole("table", { name: "หัวข้อตามแผน" })).toHaveCount(0);
  await expect(page.getByText("ไม่พูดถึง", { exact: true })).toHaveCount(0);
});

test("recording stops tracks and switching modes requires confirmation", async ({ page, request }) => {
  const id = await newRound(request);
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const get = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await get(constraints);
      Object.assign(window, { testTracks: stream.getTracks() });
      return stream;
    };
  });
  await page.goto(`/sessions/${id}/video`);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(page.locator(".guide")).toBeVisible();
  await page.getByRole("button", { name: "ติ๊กครบทุกข้อ (ยืนยันพร้อมอัด)" }).click();
  await page.getByLabel("นับถอยหลัง").selectOption("0");
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  await expect(page.getByRole("button", { name: /หยุด \(0:01/ })).toBeVisible();
  await page.getByRole("button", { name: /^หยุด \(/ }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { testTracks: MediaStreamTrack[] }).testTracks.map((track) => track.readyState)
  )).toEqual(["ended", "ended"]);
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "ยกเลิก", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  await dialog.getByRole("button", { name: "เปลี่ยนโหมดและล้างคลิป" }).click();
  await expect(page.getByLabel("คลิปที่อัดไว้")).toHaveCount(0);
});

// ---- D-046: coaching and explainability ----
async function finishedRound(request: APIRequestContext) {
  const id = await newRound(request);
  expect((await request.post(`/api/sessions/${id}/video`, { multipart: { video: await sample(request) } })).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/done`)).ok()).toBeTruthy();
  return id;
}

async function rewind(page: import("@playwright/test").Page) {
  const video = page.getByLabel("วิดีโอการซ้อม", { exact: true });
  await video.evaluate((el: HTMLVideoElement) => { el.pause(); el.currentTime = 0; });
  return () => video.evaluate((el: HTMLVideoElement) => el.currentTime);
}

test("coach times, timeline markers and transcript phrases seek the video", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.goto(`/sessions/${id}`);
  const coach = page.getByRole("region", { name: "คำแนะนำจาก AI Coach" });
  await expect(coach).toContainText("จุดที่ทำได้ดี");
  await expect(coach).toContainText("ควรโฟกัสปรับก่อน");
  await expect(coach).toContainText("แผนฝึกซ้อมรอบถัดไป");
  await expect(coach.getByRole("button", { name: "ไปยังเวลา 0:02 ที่โค้ชอ้าง" })).toHaveCount(2);   // [0:02] and [00:02]

  let now = await rewind(page);
  await coach.getByRole("button", { name: "ไปยังเวลา 0:02 ที่โค้ชอ้าง" }).first().click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);

  now = await rewind(page);
  const timeline = page.getByLabel("แถบเวลาหลักฐานทุกเกณฑ์");
  // fixture: every span is 2-3 s, so speech-lane markers overlap; the last one drawn (S3) is on top
  await timeline.getByRole("button", { name: /ไปยังเวลา 0:02\.0 \(S3/ }).last().click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);

  await page.getByText("บทพูดที่ถอดเสียง").click();
  const box = page.locator(".transcript");
  await expect(box.locator("mark", { hasText: "เอ่อ" })).toBeVisible();
  await expect(box).toContainText("เงียบ 2.1 วินาที");
  now = await rewind(page);
  await box.getByRole("button", { name: /ครับ/ }).click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);
  await expect(box.locator(".phrase.playing")).toHaveText("ครับ");
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("cards show a 4-step level band and a plain-language reading", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.goto(`/sessions/${id}`);
  await expect(page.locator(".card")).toHaveCount(8);
  await expect(page.getByRole("img", { name: "ระดับ 3 จาก 4" })).toHaveCount(4);
  await expect(page.getByRole("img", { name: "ระดับ 1 จาก 4" })).toHaveCount(1);
  const s1 = page.locator(".card", { hasText: "อัตราการพูด" });
  await expect(s1.locator(".reading")).toContainText("ความเร็วพอดี · อยู่ในช่วงแนะนำ");
  await expect(page.locator(".card", { hasText: "ลำดับหัวข้อเทียบกับแผน" }).locator(".reading"))
    .toContainText("เรียงตามแผนเกือบทั้งหมด");
  await expect(page.locator(".template").first()).not.toContainText("[ร่าง");
});

test("two finished rounds show the level-change panel and a delta badge", async ({ page, request }) => {
  await finishedRound(request);
  const second = await finishedRound(request);
  await page.goto("/");
  const trend = page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" });
  await expect(trend).toBeVisible();
  await expect(trend.getByRole("row")).toHaveCount(9);                        // header + 8 criteria
  await expect(trend.getByRole("row", { name: /S2/ })).toContainText("= คงที่");
  await page.goto(`/sessions/${second}`);
  await expect(page.locator(".card", { hasText: "การหยุดพูดยาว" }).locator(".delta")).toHaveText("= คงที่ (ระดับ 3)");
  await expect(page.locator(".delta")).toHaveCount(8);
  for (const width of [360, 1440]) {
    await page.goto("/");
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("four university presentation templates, each with 4-5 topics so C1 can give a level", async ({ page }) => {
  await page.goto("/new");
  const templates = page.getByRole("group", { name: "เลือกแม่แบบโครงสร้างการนำเสนอ" });
  await expect(templates.getByRole("button")).toHaveCount(4);
  for (const [label, summary] of [
    ["สอบเค้าโครงโครงงาน", "10 นาที • 4 หัวข้อ"],
    ["สอบความก้าวหน้าโครงงาน", "10 นาที • 4 หัวข้อ"],
    ["สอบป้องกันโครงงานฉบับสมบูรณ์", "15 นาที • 5 หัวข้อ"],
    ["สัมมนา / นำเสนอบทความวิจัย", "10 นาที • 4 หัวข้อ"],
  ]) {
    await expect(templates.getByRole("button", { name: label })).toContainText(summary);
  }
});

test("a presentation template sets the target time and draft topics", async ({ page }) => {
  await page.goto("/new");
  const templates = page.getByRole("group", { name: "เลือกแม่แบบโครงสร้างการนำเสนอ" });
  await templates.getByRole("button", { name: /สอบความก้าวหน้าโครงงาน/ }).click();
  await expect(templates.getByRole("button", { name: /สอบความก้าวหน้าโครงงาน/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("เวลาเป้าหมายในการนำเสนอ (นาที)")).toHaveValue("10");
  await page.getByRole("button", { name: "เริ่ม", exact: true }).click();
  await expect(page.getByLabel("ชื่อหัวข้อที่ 1", { exact: true })).toHaveValue("ทบทวนเป้าหมายและขอบเขตโครงงาน");
  await expect(page.getByLabel("ชื่อหัวข้อที่ 4", { exact: true })).toHaveValue("แผนการดำเนินงานขั้นถัดไป");
  await expect(page.getByLabel("ชื่อหัวข้อที่ 5", { exact: true })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await templates.getByRole("button", { name: /สอบป้องกันโครงงานฉบับสมบูรณ์/ }).click();
  await expect(page.getByLabel("เวลาเป้าหมายในการนำเสนอ (นาที)")).toHaveValue("15");
  await expect(page.getByLabel("ชื่อหัวข้อที่ 5", { exact: true })).toHaveValue("สรุปผล ข้อจำกัด และข้อเสนอแนะ");
});

test("Guest registration preserves the rehearsal and member login works in another browser", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "ทดลองใช้งานทันที (สำหรับคณะกรรมการ / ผู้ทดสอบ)" }).click();
  await expect(page.locator(".account-menu")).toContainText("ผู้ทดลองใช้งาน");
  const id = await finishedRound(page.request);
  const email = `member-${id}@example.com`;
  await page.getByRole("link", { name: "สมัครสมาชิกเพื่อเก็บประวัติ" }).click();
  await page.getByLabel("ชื่อที่แสดง", { exact: true }).fill("สมาชิกทดสอบ");
  await page.getByLabel("อีเมล", { exact: true }).fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: false }).fill("test-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี", exact: true }).click();
  await expect(page.locator(".account-menu")).toContainText("สมาชิกทดสอบ");
  await page.goto(`/sessions/${id}`);
  await expect(page.locator(".card")).toHaveCount(8);
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto("http://127.0.0.1:18370/login");
  await other.getByLabel("อีเมล", { exact: true }).fill(email);
  await other.getByLabel("รหัสผ่าน", { exact: false }).fill("test-password-123");
  await other.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).last().click();
  await expect(other.locator(".account-menu")).toContainText("สมาชิกทดสอบ");
  await other.goto(`http://127.0.0.1:18370/sessions/${id}`);
  await expect(other.locator(".card")).toHaveCount(8);
  await other.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(other).toHaveURL(/\/login$/);
  expect((await other.request.get(`http://127.0.0.1:18370/api/sessions/${id}`)).status()).toBe(404);
  await second.close();
});

test("radar draws all eight levels and the S3 evidence shows what was said", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.goto(`/sessions/${id}`);
  const radar = page.getByRole("region", { name: "โปรไฟล์ทักษะ 8 เกณฑ์" });
  await expect(radar.locator("g[data-criterion]")).toHaveCount(8);
  await expect(radar.locator('g[data-level="unanalyzable"]')).toHaveCount(0);
  await expect(radar.locator(".radar-edge")).toHaveCount(8);                  // closed outline through all 8 axes
  await expect(radar.locator(".radar-summary")).toContainText("จาก 8 เกณฑ์ที่วิเคราะห์ได้");
  await expect(radar.locator(".radar-values li")).toHaveCount(8);
  const s3 = page.locator(".card", { hasText: "เสียงเติมและคำติดปาก" });
  await expect(s3.locator(".evidence")).toContainText('เสียงเติม "เอ่อ"');   // Contract 1.3 label
  await expect(s3.locator(".evidence")).toContainText('คำติดปาก "แบบว่า"');
  await expect(page.locator(".card", { hasText: "การใช้ท่าทางมือประกอบการพูด" })).toHaveCount(1);
  await expect(page.locator(".card", { hasText: "การหันหน้าสื่อสารกับผู้ฟัง" })).toHaveCount(1);
});

test("radar has eight axes, a good-level count and hollow unavailable points", async ({ page, request }) => {
  const id = await newRound(request);
  await request.post(`/api/sessions/${id}/video`, { multipart: { video: await sample(request) } });
  await request.post(`/browser-test/${id}/processing`);
  await request.post(`/browser-test/${id}/partial`);
  await page.goto(`/sessions/${id}`);
  const radar = page.getByRole("region", { name: "โปรไฟล์ทักษะ 8 เกณฑ์" });
  await expect(radar.locator("g[data-criterion]")).toHaveCount(8);
  await expect(radar.locator('[data-criterion="C2"]')).toHaveAttribute("data-level", "unanalyzable");
  await expect(radar.locator('[data-criterion="C2"] circle')).toHaveAttribute("fill-opacity", "0.15");
  await expect(radar.locator(".radar-edge")).toHaveCount(6);                  // no line into or out of C2
  await expect(radar.locator('[data-criterion="C2"] .radar-edge')).toHaveCount(0);
  await expect(radar.locator('[data-criterion="C1"] .radar-edge')).toHaveCount(0);
  await expect(radar.locator(".radar-values")).toContainText("C2 ความครอบคลุมเชิงความหมาย: วิเคราะห์ไม่ได้");
  await expect(radar.locator(".radar-summary")).toContainText("จาก 7 เกณฑ์ที่วิเคราะห์ได้");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("draft rubric versions remain visible together with the S3 definition note", async ({ page, request }) => {
  await finishedRound(request);
  const latest = await finishedRound(request);
  await request.post(`/browser-rubric/${latest}`);
  await page.goto("/");
  const trend = page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" });
  await expect(trend).toContainText("เกณฑ์ S3 ตั้งแต่รุ่น v0.9 รวมการตรวจคำติดปากตามบริบท");
  await page.goto(`/sessions/${latest}`);
  await expect(page.locator(".delta")).toHaveCount(8);
  await expect(page.locator(".delta").first()).toHaveAttribute("title", /S3 ตั้งแต่รุ่น v0.9/);
  await expect(page.locator(".cross-version-note")).toContainText("เกณฑ์ S3 ตั้งแต่รุ่น v0.9 รวมการตรวจคำติดปากตามบริบท");
});

test("a rubric version outside the v0.7-v0.9 drafts is not compared", async ({ page, request }) => {
  await finishedRound(request);
  const latest = await finishedRound(request);
  await request.post(`/browser-rubric/${latest}?version=v1.0`);
  await page.goto(`/sessions/${latest}`);
  await expect(page.locator(".card")).toHaveCount(8);
  await expect(page.locator(".delta")).toHaveCount(0);
  await expect(page.locator(".cross-version-note")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /ดูผล/ }).first()).toBeVisible();          // history stays listed
});
