import { test, expect, type Page } from "./helpers";
import { GUEST, PASSWORD, finishedRound, openResult, recordingClock, seenReveal, startRecording } from "./helpers";

// Runs against the second test API (port 18371) started with PROMPTPRES_REQUIRE_LOGIN=1.

async function register(page: Page, name: string, email: string) {
  await page.getByLabel("ชื่อที่แสดง", { exact: true }).fill(name);
  await page.getByLabel("อีเมล", { exact: true }).fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "สมัครและเริ่มซ้อม", exact: true }).click();
  await expect(page.locator("[data-account-menu]")).toContainText(name);
}

async function login(page: Page, email: string) {
  await page.getByLabel("อีเมล", { exact: true }).fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(PASSWORD);
  await page.locator("[data-auth-card] form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
}

const account = (page: Page) => page.locator("[data-account-menu]");

async function signOut(page: Page) {
  await account(page).getByRole("button").first().click();
  await page.getByRole("menuitem", { name: "ออกจากระบบ" }).click();
}

test("the landing is public but rehearsal routes and API still require an account", async ({ page, request }) => {
  expect((await request.get("/api/sessions")).status()).toBe(401);
  expect((await request.post("/api/sessions", { data: { target_duration_s: 900 } })).status()).toBe(401);
  const historyRequests: string[] = [];
  page.on("request", (entry) => {
    if (new URL(entry.url()).pathname === "/api/sessions") historyRequests.push(entry.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("navigation", { name: "เมนูหลัก" })).toHaveCount(0);
  await expect(page.getByText("ข้อมูลตัวอย่าง").first()).toBeVisible();       // the sample result says what it is
  expect(historyRequests).toHaveLength(0);
  for (const path of ["/new", "/sessions/s_missing", "/sessions/s_missing/video", "/progress", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === path);
    await expect(page.getByRole("button", { name: GUEST })).toBeVisible();
  }
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the curtain can be skipped and the start button reaches the sign-in card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const skip = page.locator("[data-skip]");
    await expect(skip).toBeVisible();
    await skip.click();
    await expect(skip).toHaveCount(0);
    await page.locator("#main-content").getByRole("link", { name: /เริ่มใช้งานฟรี/ }).click();
    await expect(page).toHaveURL(/#start$/);
    await expect(page.locator("#start [data-auth-card]")).toBeInViewport();
  });
});

test("reduced motion shows the landing without the curtain or the 3D stage", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", (r) => loaded.push(new URL(r.url()).pathname));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-skip]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator("#start").scrollIntoViewIfNeeded();
  await expect(page.locator("#start [data-auth-card]")).toBeVisible();
  expect(loaded.filter((p) => /Stage3D-/.test(p))).toEqual([]);
});

test("Guest button on the landing opens practice setup and a rehearsal can be analysed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const start = page.locator("#main-content").getByRole("link", { name: /เริ่มใช้งานฟรี/ });
  expect((await start.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await start.press("Enter");
  await expect(page).toHaveURL(/#start$/);
  await page.locator("#start").getByRole("button", { name: GUEST }).click();
  await expect(page).toHaveURL("/new");
  await expect(page.getByRole("button", { name: "ไปตั้งหัวข้อ" })).toBeVisible();
  const id = await finishedRound(page.request);
  await page.goto("/");
  await expect(page.locator(`#history [data-session="${id}"] a`)).toHaveAttribute("href", `/sessions/${id}`);
  await openResult(page, id);
});

test("dashboard shows an empty state, then a real unfinished round with a resume link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: GUEST }).click();
  await expect(page.getByRole("heading", { name: "ยังไม่มีรอบซ้อม" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ซ้อมรอบแรก" })).toBeVisible();
  await expect(page.getByRole("region", { name: "แนวโน้มผลการฝึกซ้อมข้ามรอบ" })).toHaveCount(0);
  const response = await page.request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(response.status()).toBe(201);
  const { session_id: id } = await response.json();
  await page.reload();
  const active = page.getByRole("region", { name: "กำลังดำเนินการ" });
  await expect(active).toContainText("ยังไม่ได้ส่งวิดีโอ");
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
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await reflows();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "ข้ามไปเนื้อหาหลัก" });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate((link) => getComputedStyle(link).outlineStyle)).not.toBe("none");
  await skip.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.goto("/login");
  await reflows();
  await page.getByRole("button", { name: GUEST }).press("Enter");
  await expect(page.getByRole("heading", { name: "ยังไม่มีรอบซ้อม" })).toBeVisible();
  await reflows();
  const start = page.getByRole("link", { name: "ซ้อมรอบแรก" });
  expect((await start.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await start.press("Enter");
  await expect(page.getByRole("button", { name: "ไปตั้งหัวข้อ" })).toBeVisible();
  await reflows();
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ" }).press("Enter");
  await page.getByRole("button", { name: "ข้ามหัวข้อ" }).press("Enter");
  await page.getByRole("button", { name: "ข้ามและไปขั้นวิดีโอ" }).press("Enter");
  await expect(page.getByRole("group", { name: "โหมดวิดีโอ" })).toBeVisible();
  await reflows();
  const [, id] = page.url().match(/\/sessions\/([^/]+)\/video$/) ?? [];
  await seenReveal(page, id);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await page.getByLabel("นับถอยหลัง").selectOption("0");
  await page.getByRole("button", { name: /ติ๊กครบทุกข้อ/ }).click();
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  const stop = page.getByRole("button", { name: "หยุดอัด" });
  await expect(recordingClock(page)).toHaveText(/0:0[1-9]/);
  expect((await stop.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await stop.click();
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  await page.getByRole("button", { name: "ส่งวิเคราะห์", exact: true }).click();
  await expect(page.getByText("รอบของคุณอยู่ในคิวแล้ว")).toBeVisible();
  expect((await page.request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  await expect(page.getByText("ระบบกำลังดูคลิปของคุณ")).toBeVisible();
  expect((await page.request.post(`/browser-test/${id}/partial`)).ok()).toBeTruthy();
  await expect(page.locator("[data-criterion]")).toHaveCount(8);
  await reflows();
  await page.getByRole("link", { name: "เริ่มซ้อมอีกครั้ง" }).press("Enter");
  await expect(page).toHaveURL("/new");
  await expect(page.getByRole("main")).toBeFocused();
});

test("registering from Guest moves the rehearsal to the new account and other accounts cannot open it", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL("/login");
  await page.getByRole("button", { name: GUEST }).click();
  await expect(account(page)).toContainText("Guest (ทดลองใช้)");
  const id = await finishedRound(page.request);
  const email = `owner-${id}@example.com`;
  const guestAccount = account(page).getByRole("button").first();
  await guestAccount.press("Enter");
  const registerLink = page.getByRole("menuitem", { name: "สมัครสมาชิกเพื่อเก็บประวัติ" });
  await expect(registerLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(registerLink).toBeHidden();
  await expect(guestAccount).toBeFocused();
  await guestAccount.press("Enter");
  await registerLink.click();
  // D-066: only registering moves Guest rounds, so the login tab says so before a Guest signs in elsewhere.
  await page.getByRole("tab", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByRole("note")).toContainText("จะไม่ย้ายตามไป");
  await page.getByRole("tab", { name: "สมัครสมาชิก" }).click();
  await expect(page.getByRole("note")).toHaveCount(0);
  await register(page, "เจ้าของรอบซ้อม", email);
  await openResult(page, id);

  // The same member in a fresh browser: the rehearsal belongs to the account, not to the old Guest cookie.
  const second = await browser.newContext({ reducedMotion: "reduce" });
  const again = await second.newPage();
  await again.addInitScript(() => localStorage.setItem("pp-v2-tour-done", "1"));
  await seenReveal(again, id);
  await again.goto(`http://127.0.0.1:18371/sessions/${id}`);
  await expect(again).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === `/sessions/${id}`);
  await login(again, email);
  await expect(again).toHaveURL(`http://127.0.0.1:18371/sessions/${id}`);
  await expect(again.locator("[data-criterion]")).toHaveCount(8);
  await expect(account(again)).toContainText("เจ้าของรอบซ้อม");
  await signOut(again);
  await expect(again).toHaveURL((url) => url.pathname === "/login");
  expect((await again.request.get(`http://127.0.0.1:18371/api/sessions/${id}`)).status()).toBe(401);
  await second.close();

  // A different Guest has an empty history and gets 404 for that rehearsal.
  const third = await browser.newContext();
  const stranger = await third.newPage();
  await stranger.goto("http://127.0.0.1:18371/login");
  await stranger.getByRole("button", { name: GUEST }).click();
  await expect(account(stranger)).toContainText("Guest (ทดลองใช้)");
  expect((await stranger.request.get(`http://127.0.0.1:18371/api/sessions/${id}`)).status()).toBe(404);
  expect(await (await stranger.request.get("http://127.0.0.1:18371/api/sessions")).json()).toEqual([]);
  await third.close();
});

test("logging out with an unsent clip asks first, and staying keeps the clip and the account", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: GUEST }).click();
  await expect(account(page)).toContainText("Guest (ทดลองใช้)");
  const response = await page.request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(response.status()).toBe(201);
  const { session_id: id } = await response.json();
  await page.goto(`/sessions/${id}/video`);
  await startRecording(page);
  await page.getByRole("button", { name: "หยุดอัด" }).click();
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();

  await signOut(page);
  const dialog = page.getByRole("dialog", { name: "ออกจากขั้นวิดีโอหรือไม่?" });
  await expect(dialog).toContainText("ยังไม่ได้ส่งวิเคราะห์");
  await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await expect(page).toHaveURL(`/sessions/${id}/video`);
  await expect(page.getByLabel("คลิปที่อัดไว้")).toBeVisible();
  expect((await page.request.get(`/api/sessions/${id}`)).status()).toBe(200);   // still signed in

  await signOut(page);
  await dialog.getByRole("button", { name: "ออกและทิ้งคลิป" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  await expect(page.getByRole("button", { name: GUEST })).toBeVisible();
  expect((await page.request.get(`/api/sessions/${id}`)).status()).toBe(401);
});
