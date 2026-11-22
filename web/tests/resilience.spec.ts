import { test, expect, type APIRequestContext } from "@playwright/test";

// Regressions from the UX audit (Nov 2026): a failed request must never look like missing data,
// and a passing network or server problem must not stop the result page for good.

async function sample(request: APIRequestContext) {
  const response = await request.get("/browser-test/clip");
  expect(response.ok()).toBeTruthy();
  return { name: "test.webm", mimeType: "video/webm", buffer: await response.body() };
}

async function uploadedRound(request: APIRequestContext) {
  const created = await request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).session_id as string;
  const video = await sample(request);
  // Dev mode has one identity and the credit guard allows 2 waiting rounds per account, so a test running
  // in parallel can hold both places for a moment (429): wait for it to finish, as a user would.
  let status = 0;
  await expect.poll(async () => (status = (await request.post(`/api/sessions/${id}/video`, { multipart: { video } })).status()),
    { intervals: [250, 500, 1000], timeout: 15_000 }).not.toBe(429);
  expect(status).toBe(200);
  return id;
}

async function finishedRound(request: APIRequestContext) {
  const id = await uploadedRound(request);
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/done`)).ok()).toBeTruthy();
  return id;
}

test("a dropped connection while waiting does not stop the result page", async ({ page, request }) => {
  // A finished round shown as "queued" once, so the test holds no place in the queue
  // (dev mode has one identity and the credit guard allows 2 waiting rounds per account).
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/result`, (route) => route.abort("internetdisconnected"), { times: 1 });
  await page.route(`**/api/sessions/${id}/result`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), status: "queued", criteria: [], coach: null } });
  }, { times: 1 });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByRole("heading", { name: "อยู่ในคิว รอเครื่องวิเคราะห์" })).toBeVisible();
  // The next poll (4 s later) is dropped by the network; the page keeps asking.
  await expect(page.getByText("ติดต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่…").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".card")).toHaveCount(8, { timeout: 15_000 });
  await expect(page.getByText("โหลดผลไม่ได้")).toHaveCount(0);
});

test("a server error (e.g. a cold start) on the first load is retried", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/result`, (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "bad gateway" }) }), { times: 1 });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByText("ติดต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่…")).toBeVisible();
  await expect(page.locator(".card")).toHaveCount(8, { timeout: 10_000 });
  await expect(page.getByText("โหลดผลไม่ได้")).toHaveCount(0);
});

test("a lasting error on the result page can be retried", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/result`, (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "ไม่มีสิทธิ์" }) }), { times: 1 });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByRole("alert")).toContainText("โหลดผลไม่ได้: ไม่มีสิทธิ์");
  await page.getByRole("button", { name: "ลองใหม่" }).click();
  await expect(page.locator(".card")).toHaveCount(8);
});

test("a failed transcript request says so and can be retried", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/transcript`, (route) => route.fulfill({ status: 500, body: "" }), { times: 1 });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByText("โหลดบทพูดที่ถอดเสียงไม่สำเร็จ")).toBeVisible();
  await expect(page.getByText("ไม่มีบทพูดสำหรับรอบนี้")).toHaveCount(0);
  await page.locator(".transcript-error").getByRole("button", { name: "ลองใหม่" }).click();
  await expect(page.locator("details.transcript")).toBeVisible();
});

test("failed criterion metadata does not claim the feedback is missing", async ({ page, request }) => {
  const id = await finishedRound(request);
  await page.route(`**/api/sessions/${id}/metadata`, (route) => route.fulfill({ status: 503, body: "" }), { times: 1 });
  await page.goto(`/sessions/${id}`);
  await expect(page.getByText("โหลดคำอธิบายระดับและข้อเสนอแนะรายเกณฑ์ไม่สำเร็จ")).toBeVisible();
  await expect(page.locator(".card .template").first()).toContainText("โหลดข้อเสนอแนะไม่สำเร็จ");
  await expect(page.getByText("ไม่ทราบว่าค่าใดใช้คิดระดับ")).toHaveCount(0);
  await page.locator(".result-load-error").getByRole("button", { name: "ลองใหม่" }).click();
  await expect(page.getByText("โหลดคำอธิบายระดับและข้อเสนอแนะรายเกณฑ์ไม่สำเร็จ")).toHaveCount(0);
  await expect(page.locator(".card .template").first()).not.toContainText("โหลดข้อเสนอแนะไม่สำเร็จ");
  await expect(page.locator(".card .reading").first()).toBeVisible();
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
  const card = page.locator(".session-card").filter({ has: page.locator(`a[href="/sessions/${id}"]`) });
  await expect(card.locator(".status")).toHaveText("รอคิว");
  await page.clock.runFor(10_000);
  await expect(card.locator(".status")).toHaveText("พร้อมดูผล");
  await expect(card.locator("dd").first()).toHaveText("0:05");        // whole seconds, not "0:05.0"
});
