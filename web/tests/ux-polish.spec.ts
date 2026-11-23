import { test, expect, GUEST, finishedRound } from "./helpers";

// Regressions from the UX audits (Nov 2026): layout and keyboard details of the practice setup and login,
// and the round-5 additions (skip buttons on every animation, social login buttons that are honest).

test("setup: the topic panel sits right under the time panel on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/new");
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ" }).click();
  const topics = page.getByRole("region", { name: "หัวข้อที่จะนำเสนอ" });
  await expect(topics).toBeVisible();
  const form = await page.getByRole("main").locator("form").first().boundingBox();
  const panel = await topics.boundingBox();
  expect(panel!.y - (form!.y + form!.height)).toBeLessThan(40);
});

test("setup: focus follows a moved topic and lands on a neighbour after a delete", async ({ page }) => {
  await page.goto("/new");
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ" }).click();
  await page.getByRole("button", { name: "เพิ่มหัวข้อเอง" }).click();
  const titles = page.getByLabel(/^ชื่อหัวข้อที่/);
  await titles.nth(0).fill("ที่มา");
  await titles.nth(1).fill("วิธีทำ");
  await titles.nth(2).fill("ผล");
  await page.getByRole("button", { name: "เลื่อนหัวข้อที่ 1 ลง" }).click();
  await expect(titles.nth(1)).toHaveValue("ที่มา");
  await expect(page.getByRole("button", { name: "เลื่อนหัวข้อที่ 2 ลง" })).toBeFocused();
  await page.keyboard.press("Enter");                       // keep moving the same topic with the keyboard
  await expect(titles.nth(2)).toHaveValue("ที่มา");
  await expect(page.getByRole("button", { name: "เลื่อนหัวข้อที่ 3 ขึ้น" })).toBeFocused();   // at the end: the other arrow
  await page.getByRole("button", { name: "ลบหัวข้อที่ 2" }).click();
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(1)).toBeFocused();
});

test("a signed-in member who opens the login page goes straight on", async ({ page }) => {
  const email = `member-${Date.now()}@example.com`;
  const registered = await page.request.post("/api/auth/register",
    { data: { email, display_name: "สมาชิกทดสอบ", password: "test-password-123" } });
  expect(registered.ok()).toBeTruthy();
  await page.goto("/login?next=/new");
  await expect(page).toHaveURL("/new");
  await expect(page.getByRole("heading", { level: 1, name: "ซ้อมรอบใหม่" })).toBeVisible();
});

test("social login buttons say they are coming soon and send no request", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) calls.push(r.url()); });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: GUEST })).toBeVisible();
  const before = calls.length;
  for (const provider of ["Google", "LINE", "GitHub"]) {
    await page.getByRole("button", { name: `ดำเนินการต่อด้วย ${provider} (เร็ว ๆ นี้)` }).click();
    await expect(page.locator("[data-social] [role=status], [data-social] + [role=status]").first()).toContainText(`เข้าสู่ระบบด้วย ${provider} จะเปิดเร็ว ๆ นี้`);
  }
  expect(calls.slice(before)).toEqual([]);
  await expect(page).toHaveURL("/login");
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the result reveal has a skip button and does not play twice", async ({ page, request }) => {
    const id = await finishedRound(request);
    await page.goto(`/sessions/${id}`);
    const skip = page.getByRole("button", { name: "ข้ามไปดูผล" });
    await expect(skip).toBeVisible();
    expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await skip.click();
    await expect(page.locator("[data-skip]")).toHaveCount(0);
    await expect(page.locator("[data-criterion]")).toHaveCount(8);
    await page.reload();
    await expect(page.locator("[data-criterion]")).toHaveCount(8);
    await expect(page.getByRole("button", { name: "ข้ามไปดูผล" })).toHaveCount(0);   // once per round in this tab
  });

  test("Escape skips the reveal too", async ({ page, request }) => {
    const id = await finishedRound(request);
    await page.goto(`/sessions/${id}`);
    await expect(page.getByRole("button", { name: "ข้ามไปดูผล" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-skip]")).toHaveCount(0);
  });
});
