import { test, expect, GUEST, finishedRound, noSideScroll, seenReveal } from "./helpers";

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

test("every page fits 320-1440 px without cut-off content and has its own tab title", async ({ page, request }) => {
  test.setTimeout(120_000);
  const a = await finishedRound(request), b = await finishedRound(request);
  await seenReveal(page, a, b);
  const pages: [string, string][] = [
    ["/", "หน้าหลัก"], ["/new", "ซ้อมรอบใหม่"], [`/sessions/${b}`, "ผลการซ้อม"], [`/sessions/${b}/video`, "ส่งวิดีโอ"],
    ["/progress", "ความคืบหน้า"], [`/compare?a=${a}&b=${b}`, "เทียบ 2 รอบ"], ["/recap", "สรุปเดือน"], ["/settings", "ตั้งค่า"],
    ["/help", "ช่วยเหลือ"], ["/how", "เราวัดผลอย่างไร"], ["/about", "เกี่ยวกับ PromptPre's"], ["/privacy", "ความเป็นส่วนตัว"],
    ["/login", "เข้าสู่ระบบ"], ["/no-such-page", "ไม่พบหน้านี้"],
  ];
  for (const [path, name] of pages) await test.step(path, async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await expect(page.locator("#main-content")).toBeVisible();
    await page.waitForLoadState("networkidle");             // data loaded, so the measured layout is the real one
    await expect(page).toHaveTitle(`${name} · PromptPre's`);
    await noSideScroll(page, [320, 390, 768, 1440]);
  });
});

test("?next= after login only ever goes to a path on this site", async ({ page }) => {
  const email = `member-next-${Date.now()}@example.com`;
  const registered = await page.request.post("/api/auth/register",
    { data: { email, display_name: "สมาชิกทดสอบ", password: "test-password-123" } });
  expect(registered.ok()).toBeTruthy();
  for (const next of ["//example.com/", "/\\example.com/", "/\t/example.com/", "/\n/example.com/", "https://example.com/"]) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL("/");
  }
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

  test("the reveal waits for a round list that knows the round is done, and keeps keyboard focus", async ({ page, request }) => {
    const id = await finishedRound(request);
    let lists = 0;
    // the shared list is slower than the result page: the first answer still says "processing"
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      lists += 1;
      const response = await route.fetch();
      const rows = (await response.json()) as { session_id: string; status: string }[];
      await route.fulfill({ response, json: lists === 1 ? rows.map((r) => r.session_id === id ? { ...r, status: "processing" } : r) : rows });
    });
    await page.goto(`/sessions/${id}`);
    const reveal = page.getByRole("dialog", { name: "ผลการซ้อมรอบนี้" });
    await expect(reveal).toBeVisible();
    expect(lists).toBeGreaterThanOrEqual(2);                     // asked again before the reveal started
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await reveal.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });
});

test("Ctrl+K palette keeps focus inside and gives it back on close", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("button", { name: "ค้นหาและไปที่ (Ctrl K)" });
  await search.click();
  const palette = page.getByRole("dialog", { name: "ค้นหาและไปที่" });
  await expect(palette).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    expect(await palette.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(search).toBeFocused();
});

test("the phone More menu closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const more = page.getByRole("button", { name: "เพิ่มเติม" });
  await more.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("/how shows loading, then a failed level description above the sections with a retry", async ({ page }) => {
  await page.route("**/api/criteria", (route) => route.fulfill({ status: 503, body: "" }), { times: 1 });
  await page.goto("/how");
  const failed = page.getByText("โหลดคำอธิบายระดับไม่สำเร็จ");
  await expect(failed).toBeVisible();
  const [panel, firstSection] = await Promise.all([failed.boundingBox(), page.locator("#main-content section.card").first().boundingBox()]);
  expect(panel!.y).toBeLessThan(firstSection!.y);
  await page.getByRole("button", { name: "ลองใหม่" }).click();
  await expect(failed).toHaveCount(0);
  await expect(page.locator("#T1 ol li")).not.toHaveCount(0);
});
