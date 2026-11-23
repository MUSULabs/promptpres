import { test, expect, card, finishedRound, openCard, openResult, seenReveal } from "./helpers";

// Regressions from the UX audit (Nov 2026): a failed request must never look like missing data,
// and a passing network or server problem must not stop the result page for good.

test("a dropped connection while waiting does not stop the result page", async ({ page, request }) => {
  // A finished round shown as "queued" once, so the test holds no place in the queue
  // (dev mode has one identity and the credit guard allows 2 waiting rounds per account).
  const id = await finishedRound(request);
  await seenReveal(page, id);
  // Routes registered later answer first: queued once, then one dropped poll, then the real result.
  await page.route(`**/api/sessions/${id}/result`, (route) => route.abort("internetdisconnected"), { times: 1 });
  await page.route(`**/api/sessions/${id}/result`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), status: "queued", criteria: [], coach: null } });
  }, { times: 1 });
  await page.goto(`/sessions/${id}`);
  await expect(page.locator("[data-waiting]")).toHaveAttribute("data-waiting", "queued");
  await expect(page.getByText("รอบของคุณอยู่ในคิวแล้ว")).toBeVisible();
  // The next poll (4 s later) is dropped by the network; the page keeps asking.
  await expect(page.getByText("กำลังเชื่อมต่อใหม่…").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-criterion]")).toHaveCount(8, { timeout: 15_000 });
  await expect(page.getByText("โหลดผลไม่สำเร็จ")).toHaveCount(0);
});

test("a server error (e.g. a cold start) on the first load is retried", async ({ page, request }) => {
  const id = await finishedRound(request);
  await seenReveal(page, id);
  await page.route(`**/api/sessions/${id}/result`, (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "bad gateway" }) }), { times: 1 });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByText("กำลังเชื่อมต่อใหม่…")).toBeVisible();
  await expect(page.locator("[data-criterion]")).toHaveCount(8, { timeout: 10_000 });
  await expect(page.getByText("โหลดผลไม่สำเร็จ")).toHaveCount(0);
});

test("a lasting error on the result page can be retried", async ({ page, request }) => {
  const id = await finishedRound(request);
  await seenReveal(page, id);
  await page.route(`**/api/sessions/${id}/result`, (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "ไม่มีสิทธิ์" }) }), { times: 1 });
  await page.goto(`/sessions/${id}`);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("โหลดผลไม่สำเร็จ");
  await expect(alert).toContainText("ไม่มีสิทธิ์");
  await alert.getByRole("button", { name: "ลองใหม่" }).click();
  await expect(page.locator("[data-criterion]")).toHaveCount(8);
});

test("a failed transcript request says so and can be retried", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/transcript`, (route) => route.fulfill({ status: 500, body: "" }), { times: 1 });
  await openResult(page, id);
  const box = page.locator("[data-transcript]");
  await expect(box).toContainText("โหลดบทพูดไม่สำเร็จ");
  await expect(page.getByText("รอบนี้ไม่มีบทพูดที่ถอดเสียงได้")).toHaveCount(0);
  await box.getByRole("button", { name: "ลองใหม่" }).click();
  await expect(box.locator("[data-i] mark", { hasText: "เอ่อ" })).toBeVisible();
});

test("failed criterion metadata says so, never calls every value supporting info, and can be retried", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/metadata`, (route) => route.fulfill({ status: 503, body: "" }), { times: 1 });
  await openResult(page, id);
  const banner = page.getByRole("status").filter({ hasText: "โหลดคำอธิบายระดับและคำแนะนำไม่สำเร็จ" });
  await expect(banner).toBeVisible();
  const s1 = await openCard(page, "S1");
  await expect(s1).toContainText("โหลดคำแนะนำไม่สำเร็จ");
  await expect(s1.locator("[data-values-unsplit]")).toContainText("ยังแยกไม่ได้ว่าค่าใดใช้คิดระดับ");
  await expect(s1.locator("[data-values] dt").first()).toBeVisible();
  await expect(s1.getByText("ข้อมูลประกอบ (ไม่ใช้ตัดสินระดับ)")).toHaveCount(0);

  await banner.getByRole("button", { name: "ลองโหลดอีกครั้ง" }).click();
  await expect(banner).toHaveCount(0);
  await expect(s1.locator("[data-feedback]")).toBeVisible();
  await expect(s1.locator('[data-values="scored"] dt').first()).toBeVisible();
  await expect(s1.locator("[data-values-unsplit]")).toHaveCount(0);
  await expect(card(page, "S1").locator("[data-reading]")).not.toHaveText(/^ระดับ \d จาก 4$/);
});

test("the dashboard updates a round's status while it is being analysed", async ({ page, request }) => {
  // A finished round listed as "queued" once, so the test holds no place in the analysis queue.
  const id = await finishedRound(request);
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const rows = (await response.json()) as { session_id: string; status: string }[];
    await route.fulfill({ response, json: rows.map((row) => row.session_id === id ? { ...row, status: "queued" } : row) });
  }, { times: 1 });
  await page.clock.install();
  await page.goto("/");
  const row = page.locator(`#history [data-session="${id}"]`);
  await expect(row).toHaveAttribute("data-status", "queued");
  await expect(row).toContainText("รอคิว");
  await page.clock.runFor(10_000);
  await expect(row).toHaveAttribute("data-status", "done");
  await expect(row).toContainText("0:05");        // whole seconds, not "0:05.0"
});

test("a dashboard refresh slower than the timer is not cut off by the next tick", async ({ page, request }) => {
  const id = await finishedRound(request);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let listRequests = 0;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    listRequests += 1;
    const first = listRequests === 1;
    if (!first) await held;                   // every refresh after the first answers only when released
    try {
      const response = await route.fetch();
      const rows = (await response.json()) as { session_id: string; status: string }[];
      await route.fulfill({ response, json: first ? rows.map((row) => row.session_id === id ? { ...row, status: "queued" } : row) : rows });
    } catch { /* the page dropped the request */ }
  });
  await page.clock.install();
  await page.goto("/");
  const row = page.locator(`#history [data-session="${id}"]`);
  await expect(row).toHaveAttribute("data-status", "queued");
  await page.clock.runFor(10_000);            // the refresh starts and hangs
  await expect.poll(() => listRequests).toBe(2);
  await page.clock.runFor(20_000);            // two more ticks while it hangs: neither cancels or repeats it
  expect(listRequests).toBe(2);
  release();
  await expect(row).toHaveAttribute("data-status", "done");
});

test("a failed round list says so on every page that needs it, never an endless skeleton", async ({ page, request }) => {
  await finishedRound(request); await finishedRound(request);
  await page.route("**/api/sessions", (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "ปิดปรับปรุง" }) }) : route.continue());
  for (const path of ["/progress", "/compare", "/recap"]) {
    await page.goto(path);
    await expect(page.getByText("โหลดประวัติการซ้อมไม่สำเร็จ"), path).toBeVisible();
    await expect(page.getByRole("button", { name: "ลองใหม่" }), path).toBeVisible();
  }
  await page.unroute("**/api/sessions");
  await page.getByRole("button", { name: "ลองใหม่" }).click();         // on /recap
  await expect(page.getByText("โหลดประวัติการซ้อมไม่สำเร็จ")).toHaveCount(0);
});

test("with rounds sent but no result yet the dashboard does not say there are no rounds", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const rows = (await response.json()) as { session_id: string; status: string; source: string }[];
    const mine = rows.filter((r) => r.source === "session").slice(0, 1).map((r) => ({ ...r, status: "processing", levels: null }));
    await route.fulfill({ response, json: [...rows.filter((r) => r.source !== "session"), ...mine] });
  });
  await page.request.post("/api/sessions", { data: { target_duration_s: 900 } });   // so at least one round exists
  await page.goto("/");
  await expect(page.getByText("ยังไม่มีผลที่ออกแล้ว")).toBeVisible();
  await expect(page.getByText("ยังไม่มีรอบซ้อม")).toHaveCount(0);
});

test("a page file that fails to load offers a reload instead of an empty screen", async ({ page }) => {
  await page.route(/\/assets\/Dashboard-[^/]+\.js$/, (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "เปิดหน้านี้ไม่สำเร็จ" })).toBeVisible();
  await page.unroute(/\/assets\/Dashboard-[^/]+\.js$/);
  await page.getByRole("button", { name: "โหลดหน้าใหม่" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^สวัสดี/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "เปิดหน้านี้ไม่สำเร็จ" })).toHaveCount(0);
});
