import { test, expect, type Page } from "./helpers";
import {
  GUEST, PASSWORD, card, finishedRound, keepTracks, mainNav, newRound, noSideScroll, openCard, openResult,
  recordingClock, sample, seenReveal, startRecording, trackStates, videoClock,
} from "./helpers";

async function setPdfAvailability(page: Page, enabled: boolean) {
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), pdf_enabled: enabled } });
  });
}

const sessionId = (page: Page) => page.url().match(/\/sessions\/([^/?#]+)/)?.[1] ?? "";

test("mobile setup has a keyboard path from the first viewport to skipping topics", async ({ page, request }) => {
  await setPdfAvailability(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: GUEST }).click();
  await page.getByRole("navigation", { name: "เมนูหลัก" }).getByRole("link", { name: "ซ้อมรอบใหม่" }).click();

  const next = page.getByRole("button", { name: "ไปตั้งหัวข้อ" });
  const minutes = page.getByLabel("เวลาเป้าหมายในการนำเสนอ (นาที)");
  await expect(next).toBeInViewport({ ratio: 1 });
  await expect(minutes).toHaveValue("15");
  expect(await next.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const logo = page.getByAltText("PromptPre's", { exact: true }).first();
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const icon = await request.get("/assets/favicon.svg");
  expect(icon.ok()).toBeTruthy();
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  expect(await page.evaluate(async () => (await document.fonts.load('400 16px Prompt', 'เวลาเป้าหมาย')).length)).toBe(1);

  await minutes.fill("31");
  await expect(minutes).toHaveAttribute("aria-invalid", "true");
  await expect(next).toBeDisabled();
  await minutes.fill("12");
  await minutes.press("Enter");
  await expect(page.getByRole("heading", { name: "หัวข้อที่จะนำเสนอ" })).toBeFocused();
  await expect(page.getByLabel("เลือก PDF รายงานหรือสไลด์โครงงาน")).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "เพิ่มหัวข้อเอง" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "ข้ามหัวข้อ" })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "ข้ามการยืนยันหัวข้อหรือไม่?" });
  await expect(dialog).toContainText("C1 และ C2");
  await expect(dialog.getByRole("button", { name: "ยกเลิก" })).toBeFocused();
  await dialog.getByRole("button", { name: "ข้ามและไปขั้นวิดีโอ" }).press("Enter");
  await expect(page).toHaveURL(/\/sessions\/[^/]+\/video$/);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByText("ข้ามหัวข้อ · C1–C2 จะวิเคราะห์ไม่ได้")).toBeVisible();
});

test("PDF draft stays editable before topics are confirmed", async ({ page }) => {
  await setPdfAvailability(page, true);
  const uploadUrl = "/browser-test/synthetic-pdf";
  await page.route("**/api/sessions/*/uploads", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ kind: "pdf", filename: "sample.pdf" });
    return route.fulfill({ json: { url: uploadUrl, token: "test-pdf", chunks: 1, chunk_bytes: 8192 } });
  });
  await page.route(`**${uploadUrl}/chunks/0`, (route) => route.fulfill({ json: {} }));
  await page.route(`**${uploadUrl}/complete`, (route) => route.fulfill({ json: {
    topics: ["วัตถุประสงค์", "วิธีดำเนินงาน", "สรุปผล"].map((title) => ({ title, key_point: "" })),
    model: null,
  } }));

  await page.goto("/new");
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ" }).click();
  await page.getByLabel("เลือก PDF รายงานหรือสไลด์โครงงาน").setInputFiles({
    name: "sample.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n"),
  });
  await expect(page.getByText("sample.pdf", { exact: true })).toBeVisible();
  const firstTopic = page.getByLabel("ชื่อหัวข้อที่ 1", { exact: true });
  await expect(firstTopic).toHaveValue("วัตถุประสงค์");
  await firstTopic.fill("วัตถุประสงค์โครงงาน");
  await page.getByRole("button", { name: "ยืนยันหัวข้อ แล้วไปขั้นวิดีโอ" }).click();
  await expect(page.getByText("หัวข้อที่ยืนยัน 3 หัวข้อ")).toBeVisible();
  await page.getByText("หัวข้อที่ยืนยัน 3 หัวข้อ").click();
  await expect(page.getByText("วัตถุประสงค์โครงงาน", { exact: true })).toBeVisible();
});

test("leaving setup during confirm never pulls the user back", async ({ page }) => {
  await page.goto("/new");
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ", exact: true }).click();
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
    await mainNav(page).getByRole("link", { name: "ประวัติการซ้อม" }).click();
    await cancelled;
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(page).toHaveURL(/\/#history$/);
  await expect(page.getByRole("region", { name: "ประวัติการซ้อม" })).toBeVisible();
});

test("malformed upload response can be retried and result evidence seeks", async ({ page, request }) => {
  const id = await newRound(request);
  await seenReveal(page, id);
  await page.goto(`/sessions/${id}/video`);
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  await page.getByLabel("เลือกไฟล์วิดีโอ").setInputFiles(await sample(request));
  await page.route(`**/api/sessions/${id}/uploads/*/complete`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>invalid response</h1>" }), { times: 1 });
  const send = page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true });
  await send.click();
  await expect(page.getByRole("alert")).toContainText("เซิร์ฟเวอร์ตอบกลับในรูปแบบที่อ่านไม่ได้");
  await expect(send).toBeEnabled();
  await expect(page.getByLabel("ตัวอย่างคลิปที่เลือก")).toBeVisible();
  await send.click();
  await expect(page.getByText("รอบของคุณอยู่ในคิวแล้ว")).toBeVisible();
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  await expect(page.getByText("ระบบกำลังดูคลิปของคุณ")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("progressbar")).toHaveCount(0);           // no made-up progress
  expect((await request.post(`/browser-test/${id}/done`)).ok()).toBeTruthy();
  await expect(page.locator("[data-criterion]")).toHaveCount(8, { timeout: 8_000 });
  for (const chip of ["คลิป 0:05", "พูดจริง 0:03", "เป้าหมาย 15:00"]) await expect(page.getByText(chip, { exact: true }).first()).toBeVisible();
  const s2 = await openCard(page, "S2");
  const now = await videoClock(page);
  const time = s2.getByRole("button", { name: /^ไปยังเวลา 0:02\.0 – 0:03\.0/ }).first();
  await time.focus();
  await page.keyboard.press("Enter");
  await expect.poll(now).toBeGreaterThanOrEqual(2);
  await openCard(page, "C2");
  await expect(page.getByRole("table", { name: "หัวข้อตามแผน" })).toBeVisible();
  await noSideScroll(page);
});

test("partial C2 does not display coverage labels from stored topic rows", async ({ page, request }) => {
  const id = await finishedRound(request, "partial");
  await openResult(page, id);
  await expect(card(page, "C2")).toHaveAttribute("data-level", "na");
  await expect(card(page, "C2")).toContainText("วิเคราะห์ไม่ได้");
  await expect(page.getByText("ข้ามหัวข้อหรือวิเคราะห์เนื้อหาไม่ได้ในรอบนี้")).toBeVisible();
  await expect(page.getByRole("table", { name: "หัวข้อตามแผน" })).toHaveCount(0);
  await expect(page.getByText("ไม่พูดถึง", { exact: true })).toHaveCount(0);
});

test("recording stops tracks and switching modes requires confirmation", async ({ page, request }) => {
  const id = await newRound(request);
  await keepTracks(page);
  await page.goto(`/sessions/${id}/video`);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(page.getByLabel("ภาพจากกล้อง")).toBeVisible();
  await expect(page.getByLabel(/แสดงเส้นช่วยจัดระยะ/)).toBeChecked();
  await page.getByRole("button", { name: "ติ๊กครบทุกข้อ (ยืนยันพร้อมอัด)" }).click();
  await page.getByLabel("นับถอยหลัง").selectOption("0");
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  await expect(recordingClock(page)).toHaveText(/0:0[1-9]/);
  await page.getByRole("button", { name: "หยุดอัด" }).click();
  await expect.poll(() => trackStates(page)).toEqual(["ended", "ended"]);
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  const dialog = page.getByRole("dialog", { name: "เปลี่ยนโหมดวิดีโอหรือไม่?" });
  await expect(dialog.getByRole("button", { name: "ยกเลิก", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  await page.getByRole("button", { name: "อัปโหลดไฟล์วิดีโอ" }).click();
  await dialog.getByRole("button", { name: "เปลี่ยนโหมดและล้างคลิป" }).click();
  await expect(page.getByLabel("คลิปที่อัดไว้")).toHaveCount(0);
});

test("camera permission denial can be retried and interruption preserves the recorded clip", async ({ page, request }) => {
  const id = await newRound(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const get = media.getUserMedia.bind(media);
    let denied = false;
    media.getUserMedia = async (constraints) => {
      if (!denied) {
        denied = true;
        throw new DOMException("Denied for test", "NotAllowedError");
      }
      const stream = await get(constraints);
      Object.assign(window, { testStream: stream });
      return stream;
    };
  });
  await page.goto(`/sessions/${id}/video`);
  const open = page.getByRole("button", { name: "เปิดกล้อง", exact: true });
  await open.click();
  await expect(page.getByRole("alert")).toContainText("ไม่ได้รับอนุญาต");
  await open.click();
  await page.getByLabel("นับถอยหลัง").selectOption("0");
  await page.getByRole("button", { name: "ติ๊กครบทุกข้อ (ยืนยันพร้อมอัด)" }).click();
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).press("Enter");
  await expect(recordingClock(page)).toHaveText(/0:0[1-9]/);
  await page.evaluate(() => {
    const track = (window as unknown as { testStream: MediaStream }).testStream.getAudioTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("alert")).toContainText("หลุดระหว่างใช้งาน");
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true })).toBeEnabled();
});

// ---- D-046: coaching and explainability ----

test("result keeps criteria and readable evidence when the coach and video are unavailable", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/result`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), coach: null, video_url: null } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openResult(page, id);
  const coach = page.getByRole("region", { name: "สิ่งที่ควรปรับ" });
  await expect(coach).toContainText("รอบนี้ไม่มีสรุปจุดที่ควรปรับจากโค้ช");
  await coach.getByRole("link", { name: "เปิดข้อเสนอแนะรายเกณฑ์" }).press("Enter");
  await expect(page).toHaveURL(/#result-criteria$/);
  await expect(page.getByRole("heading", { name: "ผลรายเกณฑ์" })).toBeFocused();
  await expect(page.getByText("รอบนี้ไม่มีวิดีโอสำหรับเปิดดู")).toBeVisible();
  const s2 = await openCard(page, "S2");
  await expect(s2.locator("[data-evidence] [data-time-text]").first()).toContainText("0:02.0 – 0:03.0");
  await expect(page.getByRole("button", { name: /^ไปยังเวลา/ })).toHaveCount(0);
  await page.getByRole("link", { name: "เริ่มซ้อมอีกครั้ง" }).press("Enter");
  await expect(page).toHaveURL("/new");
});

test("coach times, timeline markers and transcript phrases seek the video", async ({ page, request }) => {
  const id = await finishedRound(request);
  await openResult(page, id);
  const coach = page.getByRole("region", { name: "สิ่งที่ควรปรับ" });
  const handNote = coach.getByRole("listitem").filter({ hasText: "มือนิ่งค้างที่" });
  const pauseItem = coach.getByRole("listitem").filter({ hasText: "หยุดเงียบที่" });
  const timeline = page.getByRole("group", { name: "แถบเวลาหลักฐานทุกเกณฑ์" });
  await expect(coach.getByRole("button", { name: "ไปยังเวลา 0:02 ที่โค้ชอ้าง" })).toHaveCount(2);

  let now = await videoClock(page);
  await handNote.getByRole("button", { name: "ไปยังเวลา 0:02 ที่โค้ชอ้าง" }).click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);

  await expect(page.getByRole("region", { name: "สิ่งที่ทำได้ดี" })).toContainText("ความเร็วการพูดอยู่ในช่วงแนะนำตลอด");
  await expect(page.getByRole("region", { name: "เป้าหมายรอบถัดไป" })).toContainText("ซ้อมช่วงเปลี่ยนหัวข้ออีก 2 รอบ");
  now = await videoClock(page);
  await pauseItem.getByRole("button", { name: "ไปยังเวลา 0:02 ที่โค้ชอ้าง" }).press("Enter");
  await expect.poll(now).toBeGreaterThanOrEqual(2);

  now = await videoClock(page);
  await expect(timeline).toHaveAttribute("data-playing", "false");
  // fixture: every span is 2-3 s, so speech-lane markers overlap; pick the S3 one by name
  await timeline.getByRole("button", { name: /ไปยังเวลา 0:02\.0 \(S3/ }).first().press("Enter");   // markers overlap: use the keyboard
  await expect.poll(now).toBeGreaterThanOrEqual(2);

  const box = page.locator("[data-transcript]");
  await expect(box.locator("[data-i] mark", { hasText: "เอ่อ" })).toBeVisible();
  await expect(box).toContainText("เงียบ 2.1 วินาที");
  now = await videoClock(page);
  await box.getByRole("button", { name: /ครับ/ }).click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);
  await expect(box.locator("button[data-playing]")).toHaveText("ครับ");
  await noSideScroll(page);
});

test("cards show a 4-step level band and a plain-language reading", async ({ page, request }) => {
  const id = await finishedRound(request);
  await openResult(page, id);
  const cards = page.locator("[data-criterion]");
  await expect(cards.getByRole("img", { name: "ระดับ 3 จาก 4" })).toHaveCount(4);
  await expect(cards.getByRole("img", { name: "ระดับ 1 จาก 4" })).toHaveCount(1);
  await expect(card(page, "S1").locator("[data-reading]")).toContainText("ความเร็วพอดี · อยู่ในช่วงแนะนำ");
  await expect(card(page, "C1").locator("[data-reading]")).toContainText("เรียงตามแผนเกือบทั้งหมด");
  const s1 = await openCard(page, "S1");
  await expect(s1.locator("[data-feedback]")).not.toContainText("[ร่าง");
});

test("two finished rounds show the trend and a comparison badge on every card", async ({ page, request }) => {
  await finishedRound(request);
  const second = await finishedRound(request);
  await page.goto("/");
  const trend = page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" });
  await expect(trend).toBeVisible();
  await trend.getByRole("button", { name: "ตาราง" }).click();
  await expect(trend.getByRole("table").getByRole("row")).toHaveCount(9);   // header + 8 criteria
  await openResult(page, second);
  await expect(card(page, "S2").locator("[data-delta]")).toHaveText("คงที่");
  await expect(page.locator("[data-criterion] [data-delta]")).toHaveCount(8);
  await page.goto("/");
  await noSideScroll(page);
});

test("four university presentation templates, each with 4-5 topics so C1 can give a level", async ({ page }) => {
  await page.goto("/new");
  const templates = page.getByRole("group", { name: "เลือกแม่แบบโครงสร้างการนำเสนอ" });
  await expect(templates).toHaveCount(0);
  await page.getByRole("button", { name: /^เลือกแม่แบบ/ }).click();
  await expect(templates.getByRole("button")).toHaveCount(4);
  for (const [label, summary] of [
    ["สอบเค้าโครงโครงงาน", "10 นาที · 4 หัวข้อ"],
    ["สอบความก้าวหน้าโครงงาน", "10 นาที · 4 หัวข้อ"],
    ["สอบป้องกันโครงงานฉบับสมบูรณ์", "15 นาที · 5 หัวข้อ"],
    ["สัมมนา / นำเสนอบทความวิจัย", "10 นาที · 4 หัวข้อ"],
  ]) {
    await expect(templates.getByRole("button", { name: label })).toContainText(summary);
  }
});

test("a presentation template sets the target time and draft topics", async ({ page }) => {
  await page.goto("/new");
  const templates = page.getByRole("group", { name: "เลือกแม่แบบโครงสร้างการนำเสนอ" });
  await page.getByRole("button", { name: /^เลือกแม่แบบ/ }).click();
  await templates.getByRole("button", { name: /สอบความก้าวหน้าโครงงาน/ }).click();
  await expect(templates.getByRole("button", { name: /สอบความก้าวหน้าโครงงาน/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("เวลาเป้าหมายในการนำเสนอ (นาที)")).toHaveValue("10");
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ", exact: true }).click();
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
  await page.getByRole("button", { name: GUEST }).click();
  const menu = page.locator("[data-account-menu]");
  await expect(menu).toContainText("Guest (ทดลองใช้)");
  const id = await finishedRound(page.request);
  const email = `member-${id}@example.com`;
  await menu.getByRole("button").click();
  await page.getByRole("menuitem", { name: "สมัครสมาชิกเพื่อเก็บประวัติ" }).click();
  await page.getByLabel("ชื่อที่แสดง", { exact: true }).fill("สมาชิกทดสอบ");
  await page.getByLabel("อีเมล", { exact: true }).fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "สมัครและเริ่มซ้อม", exact: true }).click();
  await expect(menu).toContainText("สมาชิกทดสอบ");
  await openResult(page, id);
  const second = await browser.newContext({ reducedMotion: "reduce" });
  const other = await second.newPage();
  await other.addInitScript(() => localStorage.setItem("pp-v2-tour-done", "1"));
  await other.goto("http://127.0.0.1:18370/login");
  await other.getByLabel("อีเมล", { exact: true }).fill(email);
  await other.getByLabel("รหัสผ่าน", { exact: true }).fill(PASSWORD);
  await other.locator("[data-auth-card] form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(other.locator("[data-account-menu]")).toContainText("สมาชิกทดสอบ");
  await seenReveal(other, id);
  await other.goto(`http://127.0.0.1:18370/sessions/${id}`);
  await expect(other.locator("[data-criterion]")).toHaveCount(8);
  await other.getByLabel("บัญชี สมาชิกทดสอบ").click();
  await other.getByRole("menuitem", { name: "ออกจากระบบ" }).click();
  await expect(other).toHaveURL(/\/login$/);
  expect((await other.request.get(`http://127.0.0.1:18370/api/sessions/${id}`)).status()).toBe(404);
  await second.close();
});

test("radar draws all eight levels and the S3 evidence shows what was said", async ({ page, request }) => {
  const id = await finishedRound(request);
  await openResult(page, id);
  const radar = page.getByRole("img", { name: /^กราฟเรดาร์ 8 เกณฑ์/ }).first();
  await expect(radar.locator("g[data-axis]")).toHaveCount(8);
  await expect(radar.locator('g[data-level="unanalyzable"]')).toHaveCount(0);
  expect((await radar.locator('[data-shape="now"]').getAttribute("points"))!.trim().split(/\s+/)).toHaveLength(8);
  await expect(radar).not.toHaveAttribute("aria-label", /วิเคราะห์ไม่ได้/);
  const s3 = await openCard(page, "S3");
  await expect(s3.locator("[data-evidence]")).toContainText('เสียงเติม "เอ่อ"');   // Contract 1.3 label
  await expect(s3.locator("[data-evidence]")).toContainText('คำติดปาก "แบบว่า"');
  await expect(card(page, "N1")).toContainText("การใช้ท่าทางมือประกอบการพูด");
  await expect(card(page, "N2")).toContainText("การหันหน้าสื่อสารกับผู้ฟัง");
});

test("radar skips an unanalysable axis instead of drawing it as a low level", async ({ page, request }) => {
  const id = await finishedRound(request, "partial");
  await openResult(page, id);
  const radar = page.getByRole("img", { name: /^กราฟเรดาร์ 8 เกณฑ์/ }).first();
  await expect(radar.locator("g[data-axis]")).toHaveCount(8);
  await expect(radar.locator('g[data-axis="C2"]')).toHaveAttribute("data-level", "unanalyzable");
  await expect(radar.locator('g[data-axis="C2"] circle').last()).toHaveAttribute("stroke-dasharray", "3 3");
  expect((await radar.locator('[data-shape="now"]').getAttribute("points"))!.trim().split(/\s+/)).toHaveLength(7);
  await expect(radar).toHaveAttribute("aria-label", /ความครอบคลุม วิเคราะห์ไม่ได้/);
  await noSideScroll(page, [360]);
});

test("draft rubric versions are compared together with the S3 definition note", async ({ page, request }) => {
  await finishedRound(request);
  const latest = await finishedRound(request);
  await request.post(`/browser-rubric/${latest}`);
  await page.goto("/");
  const trend = page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" });
  await expect(trend.locator("[data-rubric-note]")).toContainText("เกณฑ์ S3 ตั้งแต่รุ่น v0.9 รวมการตรวจคำติดปากตามบริบท");
  await openResult(page, latest);
  await expect(page.locator("[data-criterion] [data-delta]")).toHaveCount(8);
  await expect(page.locator("main [data-rubric-note]")).toContainText("เกณฑ์ S3 ตั้งแต่รุ่น v0.9 รวมการตรวจคำติดปากตามบริบท");
});

test("a rubric version outside the v0.7-v0.9 drafts is not compared", async ({ page, request }) => {
  await finishedRound(request);
  const latest = await finishedRound(request);
  await request.post(`/browser-rubric/${latest}?version=v1.0`);
  await openResult(page, latest);
  await expect(page.locator("[data-delta]")).toHaveCount(0);
  await expect(page.locator("[data-rubric-note]")).toHaveCount(0);
  await expect(page.getByText("ยังไม่มีรอบก่อนที่ใช้เกณฑ์รุ่นที่เทียบกันได้", { exact: false })).toBeVisible();
  await page.goto("/");
  await expect(page.locator(`#history [data-session="${latest}"]`)).toBeVisible();     // history stays listed
});

test("a recorded round goes from the video step to its result in one tab", async ({ page }) => {
  await page.goto("/new");
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ" }).click();
  await page.getByRole("button", { name: "ข้ามหัวข้อ" }).click();
  await page.getByRole("button", { name: "ข้ามและไปขั้นวิดีโอ" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+\/video$/);
  const id = sessionId(page);
  await seenReveal(page, id);
  await startRecording(page);
  await page.getByRole("button", { name: "หยุดอัด" }).click();
  await page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true }).click();
  await expect(page).toHaveURL(`/sessions/${id}`);
  await expect(page.locator("[data-waiting]")).toBeVisible();
  expect((await page.request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  expect((await page.request.post(`/browser-test/${id}/partial`)).ok()).toBeTruthy();
  await expect(page.locator("[data-criterion]")).toHaveCount(8, { timeout: 10_000 });
});

test("T1 'just right' bands come from the config, and are left out when it cannot be loaded", async ({ page, request }) => {
  const config = await (await request.get("/api/criteria")).json() as { T1: { levels: Record<string, { deviation_pct: number }> } };
  const l4 = config.T1.levels["4"].deviation_pct;
  const id = await finishedRound(request);
  await openResult(page, id);
  const t1 = await openCard(page, "T1");
  await expect(t1.locator('[data-band="4"]')).toHaveCount(1);
  await expect(t1.locator('[data-band="3"]')).toHaveCount(1);

  const round = await newRound(request);
  await page.goto(`/sessions/${round}/video`);
  await expect(page.getByText(`ช่วงพอดี ±${l4}%`)).toBeVisible();

  const other = await page.context().newPage();                  // a fresh page load: the shared request starts over
  await other.route("**/api/criteria", (route) => route.fulfill({ status: 503, body: "" }));
  await other.goto(`/sessions/${round}/video`);
  await expect(other.getByText(/^เป้า \d+:\d{2}$/)).toBeVisible();
  await expect(other.getByText(/ช่วงพอดี ±/)).toHaveCount(0);
  await other.close();
});
