import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Runs against the second test API (port 18371) started with PROMPTPRES_REQUIRE_LOGIN=1.
const GUEST = "ทดลองใช้งานทันที (สำหรับคณะกรรมการ / ผู้ทดสอบ)";
const PASSWORD = "test-password-123";

async function finishedRound(request: APIRequestContext) {
  const created = await request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).session_id as string;
  const clip = await (await request.get("/browser-test/clip")).body();
  const upload = await request.post(`/api/sessions/${id}/video`, {
    multipart: { video: { name: "test.webm", mimeType: "video/webm", buffer: clip } },
  });
  expect(upload.ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/done`)).ok()).toBeTruthy();
  return id;
}

async function register(page: Page, name: string, email: string) {
  await page.getByLabel("ชื่อที่แสดง", { exact: true }).fill(name);
  await page.getByLabel("อีเมล", { exact: true }).fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: false }).fill(PASSWORD);
  await page.getByRole("button", { name: "สร้างบัญชี", exact: true }).click();
  await expect(page.locator(".account-menu")).toContainText(name);
}

test("the landing is public but rehearsal routes and API still require an account", async ({ page, request }) => {
  expect((await request.get("/api/sessions")).status()).toBe(401);
  expect((await request.post("/api/sessions", { data: { target_duration_s: 900 } })).status()).toBe(401);
  const historyRequests: string[] = [];
  page.on("request", (entry) => {
    if (new URL(entry.url()).pathname === "/api/sessions") historyRequests.push(entry.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /ซ้อมก่อน.*พรีเซนต์จริง/ })).toBeVisible();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("navigation", { name: "เมนูหลัก" })).toHaveCount(0);
  expect(historyRequests).toHaveLength(0);
  for (const path of ["/new", "/sessions/s_missing", "/sessions/s_missing/video"]) {
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === path);
    await expect(page.getByRole("button", { name: GUEST })).toBeVisible();
  }
});

test("landing motion keeps the start action available and follows reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const headline = page.locator(".landing-title-second");
  await expect(headline).toHaveCSS("animation-name", "landing-title-in");
  const start = page.locator(".landing-hero").getByRole("link", { name: "เริ่มซ้อม" });
  await start.click();
  await expect(page).toHaveURL(url => url.pathname === "/login" && url.searchParams.get("next") === "/new");

  await page.goto("/");
  const stage = page.locator(".landing-story-stage");
  await expect(stage).toHaveCSS("position", "sticky");
  for (const chapter of ["record", "review", "improve", "repeat"]) {
    await page.locator(`[data-landing-chapter="${chapter}"]`).evaluate(el => el.scrollIntoView({ block: "center" }));
    await expect(stage).toHaveAttribute("data-chapter", chapter);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(headline).toHaveCSS("animation-name", "none");
  await expect(stage).toBeHidden();
  const art = await page.locator(".landing-story-inline").all();
  expect(art).toHaveLength(4);
  for (const item of art) {
    await expect(item).toBeVisible();
    await expect(item).toHaveCSS("animation-name", "none");
  }
});

test("Guest button opens the app and a rehearsal can be analysed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const instructions = page.getByRole("link", { name: "วิธีใช้งาน" });
  await instructions.press("Enter");
  await expect(page).toHaveURL(/#how-to-practice$/);
  await expect(page.getByRole("region", { name: "วิธีใช้งาน" })).toBeFocused();
  const start = page.locator(".landing-hero").getByRole("link", { name: "เริ่มซ้อม" });
  expect((await start.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await start.press("Enter");
  await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === "/new");
  const example = page.getByRole("group", { name: "จุดเวลาในตัวอย่าง" });
  const firstCue = example.getByRole("button", { name: "0:14 เกริ่นที่มาของโครงงาน" });
  await firstCue.press("Enter");
  await expect(firstCue).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("“ทีมเราเริ่มจากปัญหาที่พบตอนซ้อมนำเสนอ…”")).toBeVisible();
  await page.getByRole("button", { name: GUEST }).click();
  await expect(page).toHaveURL("/new");
  await expect(page.getByRole("heading", { name: "ตั้งค่ารอบซ้อม" })).toBeVisible();
  const id = await finishedRound(page.request);
  await page.getByRole("link", { name: "ประวัติ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ประวัติการซ้อม" })).toBeVisible();
  await expect(page.getByRole("region", { name: "รอบซ้อมล่าสุด" }).getByRole("link", { name: "ดูผล", exact: true }))
    .toHaveAttribute("href", `/sessions/${id}`);
  await page.goto(`/sessions/${id}`);
  await expect(page.locator(".card")).toHaveCount(8);
});

test("dashboard shows an empty state, then a real unfinished round with a resume link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: GUEST }).click();
  await expect(page.getByRole("heading", { name: "ยังไม่มีรอบซ้อม" })).toBeVisible();
  await expect(page.getByRole("link", { name: "เริ่มซ้อม", exact: true })).toBeInViewport();
  await expect(page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" })).toHaveCount(0);
  const response = await page.request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(response.status()).toBe(201);
  const { session_id: id } = await response.json();
  await page.reload();
  const active = page.getByRole("region", { name: "กำลังดำเนินการ" });
  await expect(active.getByText("ยังไม่ส่งวิดีโอ")).toBeVisible();
  await active.getByRole("link", { name: "ทำต่อ" }).press("Enter");
  await expect(page).toHaveURL(`/sessions/${id}/video`);
});

test("a visitor can record, submit, review and start another rehearsal at narrow widths", async ({ page }) => {
  const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440];
  async function reflows() {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `viewport ${width}px`).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  await page.goto("/");
  await expect(page.locator(".landing-hero")).toBeVisible();
  await reflows();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "ข้ามไปเนื้อหาหลัก" });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate((link) => getComputedStyle(link).outlineStyle)).not.toBe("none");
  await page.getByRole("link", { name: "เข้าสู่ระบบ" }).press("Enter");
  await reflows();
  await page.getByRole("button", { name: GUEST }).press("Enter");
  await expect(page.getByRole("heading", { name: "ยังไม่มีรอบซ้อม" })).toBeVisible();
  await reflows();
  const start = page.getByRole("link", { name: "เริ่มซ้อม", exact: true });
  expect((await start.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await start.press("Enter");
  await expect(page.getByRole("heading", { name: "ตั้งค่ารอบซ้อม" })).toBeVisible();
  await reflows();
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ" }).press("Enter");
  await page.getByRole("button", { name: "ข้ามหัวข้อ" }).press("Enter");
  await page.getByRole("button", { name: "ข้ามและไปขั้นวิดีโอ" }).press("Enter");
  await expect(page.getByRole("heading", { name: "ห้องซ้อมนำเสนอ" })).toBeVisible();
  await reflows();
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await page.getByLabel("นับถอยหลัง").selectOption("0");
  await page.getByRole("button", { name: /ติ๊กครบทุกข้อ/ }).click();
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  const stop = page.getByRole("button", { name: "หยุดอัด" });
  await expect(page.locator(".recording-clock")).toHaveText(/0:0[1-9]/);
  expect((await stop.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await stop.click();
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  const [, id] = page.url().match(/\/sessions\/([^/]+)\/video$/) ?? [];
  await page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true }).click();
  await expect(page.getByRole("heading", { name: "อยู่ในคิว รอเครื่องวิเคราะห์" })).toBeVisible();
  expect((await page.request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "กำลังวิเคราะห์วิดีโอการซ้อม" })).toBeVisible();
  expect((await page.request.post(`/browser-test/${id}/partial`)).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "ผลการซ้อม", exact: true })).toBeVisible();
  await reflows();
  expect(await page.locator(".cover-frame h1").evaluate((h) => getComputedStyle(h, "::after").animationName)).toBe("none");
  await page.getByRole("link", { name: "เริ่มซ้อมอีกครั้ง" }).press("Enter");
  await expect(page).toHaveURL("/new");
  await expect(page.getByRole("main")).toBeFocused();
});

test("registering from Guest moves the rehearsal to the new account and other accounts cannot open it", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL("/login");
  await page.getByRole("button", { name: GUEST }).click();
  await expect(page.locator(".account-menu")).toContainText("ผู้ทดลองใช้งาน");
  const id = await finishedRound(page.request);
  const email = `owner-${id}@example.com`;
  const guestAccount = page.getByLabel("บัญชี ผู้ทดลองใช้งาน");
  await guestAccount.press("Enter");
  const registerLink = page.getByRole("link", { name: "สมัครสมาชิกเพื่อเก็บประวัติ" });
  await expect(registerLink).toBeVisible();
  await registerLink.press("Escape");
  await expect(registerLink).toBeHidden();
  await expect(guestAccount).toBeFocused();
  await guestAccount.press("Enter");
  await registerLink.click();
  // D-066: only registering moves Guest rounds, so the login tab says so before a Guest signs in elsewhere.
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).first().click();
  await expect(page.getByRole("note")).toContainText("จะไม่ย้ายตามไป");
  await page.getByRole("button", { name: "สมัครสมาชิก", exact: true }).click();
  await expect(page.getByRole("note")).toHaveCount(0);
  await register(page, "เจ้าของรอบซ้อม", email);
  await page.goto(`/sessions/${id}`);
  await expect(page.locator(".card")).toHaveCount(8);

  // The same member in a fresh browser: the rehearsal belongs to the account, not to the old Guest cookie.
  const second = await browser.newContext();
  const again = await second.newPage();
  await again.goto(`/sessions/${id}`);
  await expect(again).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === `/sessions/${id}`);
  await again.getByLabel("อีเมล", { exact: true }).fill(email);
  await again.getByLabel("รหัสผ่าน", { exact: false }).fill(PASSWORD);
  await again.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).last().click();
  await expect(again.locator(".account-menu")).toContainText("เจ้าของรอบซ้อม");
  await again.goto(`/sessions/${id}`);
  await expect(again.locator(".card")).toHaveCount(8);
  await again.getByLabel("บัญชี เจ้าของรอบซ้อม").click();
  await again.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(again).toHaveURL((url) => url.pathname === "/login");
  expect((await again.request.get(`/api/sessions/${id}`)).status()).toBe(401);
  await second.close();

  // A different Guest has an empty history and gets 404 for that rehearsal.
  const third = await browser.newContext();
  const stranger = await third.newPage();
  await stranger.goto("/login");
  await stranger.getByRole("button", { name: GUEST }).click();
  await expect(stranger.locator(".account-menu")).toContainText("ผู้ทดลองใช้งาน");
  expect((await stranger.request.get(`/api/sessions/${id}`)).status()).toBe(404);
  expect(await (await stranger.request.get("/api/sessions")).json()).toEqual([]);
  await third.close();
});
