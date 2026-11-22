import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import type { CriteriaMeta, Result } from "./contract";

const POLL_MS = 4000;
const MAX_RETRY_MS = 30_000;

/** A dropped connection, a busy server (429) or a server error (5xx, e.g. a cold start) can pass:
 *  keep asking. Not found / not uploaded / signed out (404, 409, 401) cannot. */
export function isTransient(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status === 429 || error.status >= 500;
}

export function useSessionResult(id: string) {
  const [res, setRes] = useState<Result | null>(null);
  const [fb, setFb] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<CriteriaMeta>({});
  const [metaStatus, setMetaStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [metaAttempt, setMetaAttempt] = useState(0);
  const [err, setErr] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const done = res?.status === "done";
  useEffect(() => {
    if (!done) return;
    const controller = new AbortController();
    const { signal } = controller;
    setMetaStatus("loading");
    const metadata = id.startsWith("s_mock_")
      ? Promise.all([api.criteria(signal), api.feedback(signal)]).then(([criteria, feedback]) => ({ criteria, feedback }))
      : api.resultMetadata(id, signal);
    metadata.then((m) => { if (!signal.aborted) { setMeta(m.criteria ?? {}); setFb(m.feedback ?? {}); setMetaStatus("ready"); } })
      .catch(() => { if (!signal.aborted) { setMeta({}); setFb({}); setMetaStatus("failed"); } });
    return () => controller.abort();
  }, [id, done, metaAttempt]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const controller = new AbortController();
    const { signal } = controller;
    const load = () =>
      api.result(id, signal)
        .then((r) => {
          if (signal.aborted) return;
          failures = 0;
          setReconnecting(false);
          setRes(r);
          if (r.status === "queued" || r.status === "processing") timer = setTimeout(load, POLL_MS);
        })
        .catch((e) => {
          if (signal.aborted) return;
          if (isTransient(e)) {
            setReconnecting(true);
            timer = setTimeout(load, Math.min(MAX_RETRY_MS, POLL_MS * 2 ** failures++));
          } else {
            setReconnecting(false);
            setErr(e);
          }
        });
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, attempt]);

  const waiting = res?.status === "queued" || res?.status === "processing";
  useEffect(() => {
    if (!waiting || err) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting, err]);

  /** Ask again after a lasting error (the user pressed "ลองใหม่"). */
  const retry = () => { setErr(null); setAttempt((n) => n + 1); };
  const retryMeta = () => setMetaAttempt((n) => n + 1);

  return { res, fb, meta, metaStatus, retryMeta, err, retry, reconnecting, now };
}
