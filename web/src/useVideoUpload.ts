import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { SessionInfo } from "./contract";

export type Clip = { blob: Blob; name: string };

export function useVideoUpload(id: string, onSubmitted: () => void, onSessionChanged: (info: SessionInfo) => void) {
  const pending = useRef<AbortController | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {                 // closing or reloading the tab mid-upload would throw the sent chunks away
    if (!sending) return;
    const stay = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [sending]);

  async function send(clip: Clip) {
    if (pending.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setSending(true);
    setProgress(null);
    setError(null);
    try {
      await api.uploadVideo(id, clip.blob, clip.name, (value) => {
        if (!signal.aborted) setProgress(value);
      }, signal);
      if (!signal.aborted) onSubmitted();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const info = await api.session(id, signal);
          if (!signal.aborted && info.status !== "created") {
            onSessionChanged(info);
            return;
          }
        } catch { /* Keep the original upload error if the status check fails. */ }
      }
      if (!signal.aborted) setError((error as Error).message);
    } finally {
      pending.current = null;
      if (!signal.aborted) {
        setSending(false);
        setProgress(null);
      }
    }
  }

  return { send, sending, progress, error, setError, isSending: () => pending.current !== null };
}
