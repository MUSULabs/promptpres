import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import type { DraftTopic, SessionInfo } from "./contract";
import { topicProblems } from "./topicProblems";
import { TEMPLATES, type PresentationTemplate } from "./templates";

type Task = "start" | "pdf" | "confirm";

export function useNewSession() {
  const navigate = useNavigate();
  const [minutes, setMinutes] = useState(15);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [topics, setTopics] = useState<DraftTopic[] | null>(null);
  const [draft, setDraft] = useState<{ pdfName: string; note: string | null } | null>(null);
  const [busy, setBusy] = useState<Task | null>(null);
  const [template, setTemplate] = useState<PresentationTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const validTarget = Number.isFinite(minutes) && minutes >= 1 && minutes <= 60;
  const problems = topics && session ? topicProblems(topics, session.topic_limits) : [];

  useEffect(() => () => pending.current?.abort(), []);

  async function run(task: Task, work: (signal: AbortSignal) => Promise<void>) {
    if (pending.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setBusy(task);
    setError(null);
    try {
      await work(signal);
    } catch (error) {
      if (!signal.aborted) setError((error as Error).message);
    } finally {
      pending.current = null;
      if (!signal.aborted) setBusy(null);
    }
  }

  function start() {
    if (!validTarget) return;
    return run("start", async (signal) => {
      const created = await api.createSession(minutes, signal);
      if (signal.aborted) return;
      setSession(created);
      if (template && !topics) setTopics(template.topics.map((topic) => ({ ...topic })));
    });
  }

  function readPdf(file: File) {
    if (!session?.pdf_enabled) return;
    return run("pdf", async (signal) => {
      const result = await api.uploadPdf(session.session_id, file, signal);
      if (signal.aborted) return;
      setTopics(result.topics.map((topic) => ({ title: topic.title, key_point: topic.key_point ?? "" })));
      setDraft({ pdfName: file.name, note: result.note ?? null });
    });
  }

  /** Apply a presentation template: target time now, its topics now or as soon as the session exists. */
  function applyTemplate(id: string) {
    const chosen = TEMPLATES.find((t) => t.id === id);
    if (!chosen || pending.current) return;
    if (session && topics && topics.some((t) => t.title.trim())
        && !window.confirm("แทนที่หัวข้อที่มีอยู่ด้วยหัวข้อจากแม่แบบ?")) return;
    setTemplate(chosen);
    setMinutes(chosen.minutes);
    if (session) {
      setTopics(chosen.topics.map((topic) => ({ ...topic })));
      setDraft(null);
    }
    setError(null);
  }

  function addManualTopics() {
    if (!session || pending.current) return;
    setTopics(Array.from({ length: session.topic_limits.min }, () => ({ title: "", key_point: "" })));
    setDraft(null);
    setError(null);
  }

  function goToVideo(topicsToConfirm: DraftTopic[] | null) {
    if (!session || !validTarget || pending.current) return;
    const id = session.session_id;
    return run("confirm", async (signal) => {
      await api.setTarget(id, minutes, signal);
      if (signal.aborted) return;
      if (topicsToConfirm) await api.confirmTopics(id, topicsToConfirm, signal);
      if (!signal.aborted) navigate(`/sessions/${id}/video`);
    });
  }

  return { minutes, setMinutes, validTarget, session, topics, setTopics, draft, busy, error, problems, template,
    start, readPdf, addManualTopics, applyTemplate, goToVideo };
}
