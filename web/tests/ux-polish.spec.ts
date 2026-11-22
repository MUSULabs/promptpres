import { test, expect } from "@playwright/test";

// Regressions from the UX audit (Nov 2026): layout and keyboard details of the practice setup and login.

test("setup: the topic panel sits right under the time panel on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/new");
  await page.getByRole("button", { name: "ไปตั้งหัวข้อ" }).click();
  const topics = page.getByRole("region", { name: "หัวข้อที่จะนำเสนอ" });
  await expect(topics).toBeVisible();
  const form = await page.locator(".setup-panel").boundingBox();
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
  await expect(page.getByRole("heading", { name: "ตั้งค่ารอบซ้อม" })).toBeVisible();
});
