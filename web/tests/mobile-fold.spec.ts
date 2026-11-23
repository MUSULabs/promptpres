import { test, expect, card, finishedRound, openCard, openResult, videoClock } from "./helpers";

// Result cards (V2): each card shows its level, 4-step band and plain-language reading at a glance, and opens
// for measured values, feedback and evidence (handoff 03: "summarize first"). Same on a phone and a desktop.

test.use({ viewport: { width: 390, height: 844 } });

test("a phone card shows level, band and reading, and opens for values, feedback and evidence", async ({ page, request }) => {
  const id = await finishedRound(request);
  await openResult(page, id);
  for (const c of await page.locator("[data-criterion]").all()) {
    await expect(c.getByRole("img", { name: /^ระดับ \d จาก 4$/ })).toBeVisible();
    await expect(c.locator("[data-reading]")).not.toBeEmpty();
    await expect(c.locator("button[aria-expanded]").first()).toHaveAttribute("aria-expanded", "false");
  }
  await expect(page.locator("[data-criterion] [data-evidence]")).toHaveCount(0);

  const c2 = await openCard(page, "C2");
  await expect(c2.getByRole("table", { name: "หัวข้อตามแผน" })).toBeVisible();
  await expect(c2.getByRole("table", { name: "หัวข้อตามแผน" })).toContainText("หัวข้อตามแผน 5 หัวข้อ");
  await expect(c2.locator("[data-feedback]")).toBeVisible();
  const now = await videoClock(page);
  await c2.getByRole("table", { name: "หัวข้อตามแผน" }).getByRole("button", { name: /^ไปยังเวลา/ }).first().click();
  await expect.poll(now).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("picking a criterion on the skill map opens its card, also after it was closed", async ({ page, request }) => {
  const id = await finishedRound(request);
  await openResult(page, id);
  const s3 = card(page, "S3");
  const toggle = s3.locator("button[aria-expanded]").first();
  const pick = page.getByRole("button", { name: /^เสียงเติม/ }).first();
  await pick.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(s3.locator("[data-evidence]")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await pick.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("a criterion that could not be analysed never shows a level", async ({ page, request }) => {
  const id = await finishedRound(request, "partial");
  await openResult(page, id);
  const c2 = card(page, "C2");
  await expect(c2).toHaveAttribute("data-level", "na");
  await expect(c2.locator("[data-reading]")).toHaveText("วิเคราะห์ไม่ได้ในรอบนี้");
  await expect(c2).toContainText("หลักฐานไม่พอ");
  await expect(c2.getByRole("img", { name: /ระดับ \d จาก 4/ })).toHaveCount(0);
  await expect(c2).not.toContainText(/ระดับ \d/);
  await c2.locator("button[aria-expanded]").first().click();
  await expect(page.getByRole("table", { name: "หัวข้อตามแผน" })).toHaveCount(0);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("an opened card spans the row and shows its topic table", async ({ page, request }) => {
    const id = await finishedRound(request);
    await openResult(page, id);
    const c2 = await openCard(page, "C2");
    await expect(c2.getByRole("table", { name: "หัวข้อตามแผน" })).toBeVisible();
    const box = (await c2.boundingBox())!, s1 = (await card(page, "S1").boundingBox())!;
    expect(box.width).toBeGreaterThan(s1.width * 1.5);
  });
});
