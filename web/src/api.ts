import type { CriteriaMeta, ResultMetadata, DraftTopic, Result, SessionInfo, SessionRow, TranscriptItem } from "./contract";

/** Error with the API's Thai message (FastAPI puts it in `detail`). */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function decodeJson<T>(status: number, raw: string, valid?: (body: T) => boolean): T {
  const ok = status >= 200 && status < 300;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    if (ok) throw new ApiError(status, "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่อ่านไม่ได้ กรุณาลองใหม่");
  }
  if (!ok) {
    if (status === 401) window.dispatchEvent(new Event("pt-auth-expired"));
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail : detail != null ? JSON.stringify(detail) : `คำขอไม่สำเร็จ (HTTP ${status})`;
    throw new ApiError(status, message);
  }
  if (valid && !valid(body as T)) throw new ApiError(status, "ข้อมูลตอบกลับไม่ครบ กรุณาตรวจสถานะรอบซ้อมหรือลองใหม่");
  return body as T;
}

/** fetch() rejects with a browser TypeError ("Failed to fetch") when the network is down: show Thai text instead.
 *  Abort and timeout (DOMException) pass through unchanged. */
function offline(error: unknown): never {
  if (error instanceof TypeError) throw new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่");
  throw error;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init).catch(offline);
  return decodeJson<T>(response.status, await response.text());
}

function sendJson<T>(method: string, url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

const PDF_TIMEOUT_MS = 60_000;   // the API asks the LLM for topics while we wait (usually 5–15 s)
const CHUNK_TIMEOUT_MS = 120_000; // one chunk (8 MB); the cloud API ends any request after 150 s
const CHUNK_RETRIES = 3;          // a failed chunk is sent again up to 3 times (1 s, 2 s, 4 s apart)
const sid = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
const CANCELLED = "ยกเลิกการอัปโหลดแล้ว";

/** Ticket from POST /api/sessions/{id}/uploads (D-062): chunks go to `url` with the signed `token`. */
interface UploadTicket { upload_id: string; url: string; token: string; chunk_bytes: number; chunks: number }

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(new ApiError(0, CANCELLED)); };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** PUT one chunk (XHR so the page can show progress within the chunk). */
function putChunk(url: string, token: string, body: Blob, onLoaded: (bytes: number) => void,
  signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const cancel = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    const fail = (message: string) => reject(new ApiError(0, message));
    xhr.open("PUT", url);
    xhr.setRequestHeader("X-Upload-Token", token);
    xhr.timeout = CHUNK_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => {
      try { decodeJson(xhr.status, xhr.responseText); resolve(); } catch (error) { reject(error); }
    };
    xhr.onerror = () => fail("อัปโหลดไม่สำเร็จ (เชื่อมต่อเซิร์ฟเวอร์ไม่ได้)");
    xhr.onabort = () => fail(CANCELLED);
    xhr.ontimeout = () => fail("อัปโหลดเกินเวลาที่กำหนด กรุณาตรวจการเชื่อมต่อแล้วลองใหม่");
    xhr.onloadend = cleanup;
    signal?.addEventListener("abort", cancel, { once: true });
    try { xhr.send(body); } catch (error) { cleanup(); reject(error); }
  });
}

const worthRetrying = (error: unknown) =>
  error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500);

/** Chunked upload (D-062): ticket -> 8 MB chunks with retries -> complete. Returns the complete step's JSON. */
async function sendInChunks<T>(id: string, kind: "video" | "pdf", file: Blob, filename: string,
  onProgress: (p: number) => void, signal?: AbortSignal, completeSignal?: AbortSignal,
  valid?: (body: T) => boolean): Promise<T> {
  const ticket = await sendJson<UploadTicket>("POST", `${sid(id)}/uploads`, { kind, filename, size: file.size }, signal);
  for (let index = 0; index < ticket.chunks; index++) {
    const start = index * ticket.chunk_bytes;
    const part = file.slice(start, Math.min(file.size, start + ticket.chunk_bytes));
    for (let attempt = 0; ; attempt++) {
      try {
        await putChunk(`${ticket.url}/chunks/${index}`, ticket.token, part,
          (loaded) => file.size > 0 && onProgress(Math.min(1, (start + loaded) / file.size)), signal);
        break;
      } catch (error) {
        if (signal?.aborted || attempt >= CHUNK_RETRIES || !worthRetrying(error)) throw error;
        await pause(1000 * 2 ** attempt, signal);
      }
    }
  }
  onProgress(1);
  const response = await fetch(`${ticket.url}/complete`, {
    method: "POST", headers: { "X-Upload-Token": ticket.token }, signal: completeSignal ?? signal,
  }).catch(offline);
  return decodeJson<T>(response.status, await response.text(), valid);
}

export interface AuthState { user: { id: string; email: string; display_name: string; is_guest: boolean } | null; required: boolean }
export const api = {
  me: () => requestJson<AuthState>("/api/auth/me"),
  register: (email: string, display_name: string, password: string) => sendJson<AuthState>("POST", "/api/auth/register", { email, display_name, password }),
  login: (email: string, password: string) => sendJson<AuthState>("POST", "/api/auth/login", { email, password }),
  guest: () => sendJson<AuthState>("POST", "/api/auth/guest", {}),
  logout: () => sendJson<AuthState>("POST", "/api/auth/logout", {}),
  resultMetadata: (id: string, signal?: AbortSignal) => requestJson<ResultMetadata>(`${sid(id)}/metadata`, { signal }),
  sessions: (signal?: AbortSignal) => requestJson<SessionRow[]>("/api/sessions", { signal }),
  session: (id: string, signal?: AbortSignal) => requestJson<SessionInfo>(sid(id), { signal }),
  result: (id: string, signal?: AbortSignal) => requestJson<Result>(`${sid(id)}/result`, { signal }),
  feedback: (signal?: AbortSignal) => requestJson<Record<string, string>>("/api/feedback", { signal }),
  criteria: (signal?: AbortSignal) => requestJson<CriteriaMeta>("/api/criteria", { signal }),
  transcript: (id: string, signal?: AbortSignal) => requestJson<TranscriptItem[]>(`${sid(id)}/transcript`, { signal }),

  createSession: (targetMinutes: number, signal?: AbortSignal) =>
    sendJson<SessionInfo>("POST", "/api/sessions", { target_duration_s: Math.round(targetMinutes * 60) }, signal),
  setTarget: (id: string, targetMinutes: number, signal?: AbortSignal) =>
    sendJson<SessionInfo>("PATCH", sid(id), { target_duration_s: Math.round(targetMinutes * 60) }, signal),
  confirmTopics: (id: string, topics: DraftTopic[], signal?: AbortSignal) =>
    sendJson<SessionInfo>("PUT", `${sid(id)}/topics`,
      { topics: topics.map((t) => ({ title: t.title, key_point: t.key_point })) }, signal),

  /** Upload the report PDF in chunks and get draft topics back (the topic step gives up after 60 s).
   *  `note`: e.g. "too many topics, merge some". */
  async uploadPdf(id: string, pdf: File, signal?: AbortSignal): Promise<{ topics: DraftTopic[]; note?: string | null; model: string | null }> {
    const ctl = new AbortController();
    const cancel = () => ctl.abort();
    signal?.throwIfAborted();
    signal?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await sendInChunks(id, "pdf", pdf, pdf.name, (p) => {
        if (p >= 1 && timer === undefined) timer = setTimeout(() => ctl.abort(), PDF_TIMEOUT_MS);
      }, signal, ctl.signal);
    } catch (e) {
      if (ctl.signal.aborted && !signal?.aborted)
        throw new ApiError(504, "ดึงหัวข้อจาก PDF นานเกิน 60 วินาที กรุณาลองใหม่หรือเพิ่มหัวข้อเอง");
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  },

  /** Upload the video in chunks (progress 0–1); the session is queued when it returns. */
  uploadVideo(id: string, video: Blob, filename: string, onProgress: (p: number) => void,
    signal?: AbortSignal): Promise<SessionInfo> {
    return sendInChunks<SessionInfo>(id, "video", video, filename, onProgress, signal, undefined, (body) =>
      body?.session_id === id && ["queued", "processing", "done", "failed"].includes(body.status));
  },
};
