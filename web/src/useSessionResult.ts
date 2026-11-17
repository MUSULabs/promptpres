import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import type { CriteriaMeta, Result } from "./contract";

const POLL_MS = 4000;

export function useSessionResult(id: string) {
  const [res, setRes] = useState<Result | null>(null);
  const [fb, setFb] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<CriteriaMeta>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const done = res?.status === "done";
  useEffect(() => {
    if (!done) return;
    const controller = new AbortController();
    const { signal } = controller;
    const metadata = id.startsWith("s_mock_")
      ? Promise.all([api.criteria(signal), api.feedback(signal)]).then(([criteria, feedback]) => ({ criteria, feedback }))
      : api.resultMetadata(id, signal);
    metadata.then((m) => { if (!signal.aborted) { setMeta(m.criteria ?? {}); setFb(m.feedback ?? {}); } })
      .catch(() => { if (!signal.aborted) { setMeta({}); setFb({}); } });
    return () => controller.abort();
  }, [id, done]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const { signal } = controller;
    const load = () =>
      api.result(id, signal)
        .then((r) => {
          if (signal.aborted) return;
          setReconnecting(false);
          setRes(r);
          if (r.status === "queued" || r.status === "processing") timer = setTimeout(load, POLL_MS);
        })
        .catch((e) => {
          if (signal.aborted) return;
          if (e instanceof ApiError) setErr(e);
          else {
            setReconnecting(true);
            timer = setTimeout(load, POLL_MS);
          }
        });
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id]);

  const waiting = res?.status === "queued" || res?.status === "processing";
  useEffect(() => {
    if (!waiting || err) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting, err]);

  return { res, fb, meta, err, reconnecting, now };
}
