import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

/* Shared steps for the browser regressions. Rounds are created through the real API of the isolated test server
   (tests/browser_api.py); "/browser-test/{id}/processing|done|partial" moves a round on without a worker. */

export const GUEST = "ทดลองใช้งานทันที แบบ Guest ไม่ต้องสมัคร";
export const PASSWORD = "test-password-123";

/** Every test starts past the first-visit extras (home tour, cookie note); tests of those open them on purpose. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem("pp-test-keep-tour")) localStorage.setItem("pp-v2-tour-done", "1");
        localStorage.setItem("pp-v2-cookie-seen", "1");
      } catch { /* storage blocked */ }
    });
    await use(page);
  },
});
export { expect };

export async function sample(request: APIRequestContext) {
  const response = await request.get("/browser-test/clip");
  expect(response.ok()).toBeTruthy();
  return { name: "test.webm", mimeType: "video/webm", buffer: await response.body() };
}

export async function newRound(request: APIRequestContext) {
  const response = await request.post("/api/sessions", { data: { target_duration_s: 900 } });
  expect(response.status()).toBe(201);
  return (await response.json()).session_id as string;
}

export async function uploadedRound(request: APIRequestContext) {
  const id = await newRound(request);
  const video = await sample(request);
  // Dev mode has one identity and the credit guard allows 2 waiting rounds per account, so a test running
  // in parallel can hold both places for a moment (429): wait for it to finish, as a user would.
  let status = 0;
  await expect.poll(async () => (status = (await request.post(`/api/sessions/${id}/video`, { multipart: { video } })).status()),
    { intervals: [250, 500, 1000], timeout: 15_000 }).not.toBe(429);
  expect(status).toBe(200);
  return id;
}

export async function finishedRound(request: APIRequestContext, outcome: "done" | "partial" = "done") {
  const id = await uploadedRound(request);
  expect((await request.post(`/browser-test/${id}/processing`)).ok()).toBeTruthy();
  expect((await request.post(`/browser-test/${id}/${outcome}`)).ok()).toBeTruthy();
  return id;
}

/** Mark rounds whose opening scene (and stage-lights moment) has already played, so the result shows at once. */
export async function seenReveal(page: Page, ...ids: string[]) {
  const mark = (list: string[]) => {
    try {
      const old = (sessionStorage.getItem("pp-v2-reveal-seen") ?? "").split(",").filter(Boolean);
      sessionStorage.setItem("pp-v2-reveal-seen", [...old, ...list].join(","));
    } catch { /* storage blocked */ }
  };
  await page.addInitScript(mark, ids);                                   // later page loads
  if (page.url().startsWith("http")) await page.evaluate(mark, ids);      // the page already open (in-app navigation)
}

/** Open a finished round's result with the opening scene already seen. */
export async function openResult(page: Page, id: string) {
  await seenReveal(page, id);
  await page.goto(`/sessions/${id}`);
  await expect(page.locator("[data-criterion]")).toHaveCount(8);
}

export const card = (page: Page, code: string) => page.locator(`[data-criterion="${code}"]`);

/** Open (expand) a criterion card and return it. */
export async function openCard(page: Page, code: string) {
  const c = card(page, code);
  const toggle = c.locator("button[aria-expanded]").first();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return c;
}

export async function videoClock(page: Page) {
  const video = page.getByLabel("วิดีโอการซ้อม", { exact: true });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((el: HTMLVideoElement) => { el.pause(); el.currentTime = 0; });
  return () => video.evaluate((el: HTMLVideoElement) => el.currentTime);
}

export async function noSideScroll(page: Page, widths = [360, 1440]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // vw-based sizes settle on the next frame after the viewport changes
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `viewport ${width}px`).toBeLessThanOrEqual(width);
    expect(await cutOff(page), `content cut off at the edge at ${width}px`).toEqual([]);
  }
}

/** Visible content that runs past the screen edge. The page itself clips sideways overflow, so this would show
    as a cut-off card rather than a scroll bar. Content inside its own scroller or clipping box is fine. */
export function cutOff(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // A scroller is meant to hold wide content; a clipping box counts only if it is narrower than the screen
    // (the page wrappers clip at full width, which is exactly what hides a cut-off card).
    const holds = (up: Element) => {
      const x = getComputedStyle(up).overflowX, box = up.getBoundingClientRect();
      return x === "auto" || x === "scroll" || (["hidden", "clip"].includes(x) && box.width < vw - 2);
    };
    return [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || (r.right <= vw + 1 && r.left >= -1)) return false;
      if (el.closest("[aria-hidden=true], .sr-only") || getComputedStyle(el).position === "fixed") return false;
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) if (holds(up)) return false;
      return true;
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "").slice(0, 60)}`);
  });
}

/** Keep the camera tracks reachable from the test, to check they are turned off. */
export async function keepTracks(page: Page) {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const get = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await get(constraints);
      Object.assign(window, { testTracks: stream.getTracks(), testStream: stream });
      return stream;
    };
  });
}

export const trackStates = (page: Page) => page.evaluate(() =>
  (window as unknown as { testTracks: MediaStreamTrack[] }).testTracks.map((track) => track.readyState));

export const recordingClock = (page: Page) => page.getByLabel(/^เวลาที่อัด /);

export async function startRecording(page: Page) {
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await page.getByRole("button", { name: "ติ๊กครบทุกข้อ (ยืนยันพร้อมอัด)" }).click();
  await page.getByLabel("นับถอยหลัง").selectOption("0");
  await page.getByRole("button", { name: "เริ่มอัด", exact: true }).click();
  await expect(recordingClock(page)).toHaveText(/0:0[1-9]/);
}

export const mainNav = (page: Page) => page.getByRole("navigation", { name: "เมนูหลัก" }).first();
