// D-046 layer 2 — temporal trace under the video: every evidence span on one timeline, and the transcript
// with fillers (S3) and long pauses (S2). Clicking either seeks the video; the phrase being played is highlighted.
import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../api";
import type { Criterion, TranscriptItem } from "../contract";
import { CRITERION_NAME, SKILLS, fmtTime } from "../presentation";
import type { MediaState, Seek } from "./ResultParts";

export function EventTimeline({ criteria, duration, media, seek }: {
  criteria: Criterion[]; duration: number | null; media: MediaState; seek: Seek;
}) {
  if (!duration) return null;
  const byCode = Object.fromEntries(criteria.map((c) => [c.code, c]));
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / duration) * 100))}%`;
  const total = criteria.reduce((n, c) => n + c.evidence.length, 0);
  if (total === 0) return null;
  return (
    <div className="timeline" aria-label="แถบเวลาหลักฐานทุกเกณฑ์">
      <p className="timeline-title">แถบเวลาหลักฐาน <span className="muted small">({total} จุด)</span></p>
      {SKILLS.map((skill) => {
        const spans = skill.codes.flatMap((code) => (byCode[code]?.evidence ?? []).map((e) => ({ code, e })));
        return <div key={skill.key} className={`lane lane-${skill.key}`}>
          <span className="lane-label">{skill.label}</span>
          <div className="lane-track">
            {spans.map(({ code, e }, i) => {
              const label = `${fmtTime(e.start_s)} (${code} ${CRITERION_NAME[code]})`;
              const style = { left: pct(e.start_s), width: `max(6px, ${pct(e.end_s - e.start_s)})` };
              return media === "ready"
                ? <button key={i} type="button" className="marker" style={style} title={`${label}${e.note ? ` — ${e.note}` : ""}`}
                  aria-label={`ไปยังเวลา ${label}`} onClick={() => seek(e.start_s)} />
                : <span key={i} className="marker" style={style} title={label} />;
            })}
          </div>
        </div>;
      })}
      <div className="timeline-scale muted small" aria-hidden="true"><span>0:00</span><span>{fmtTime(duration)}</span></div>
    </div>
  );
}

export function TranscriptBox({ sessionId, video, media, seek }: {
  sessionId: string; video: RefObject<HTMLVideoElement>; media: MediaState; seek: Seek;
}) {
  const [items, setItems] = useState<TranscriptItem[] | null>(null);
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.transcript(sessionId, controller.signal).then(setItems).catch(() => {
      if (!controller.signal.aborted) setItems([]);
    });
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    const player = video.current;
    if (!player || !items?.length) return;
    const update = () => {
      const t = player.currentTime;
      let index = -1;
      for (let i = 0; i < items.length && items[i].start_s <= t; i++) index = i;
      setActive((old) => (old === index ? old : index));
    };
    player.addEventListener("timeupdate", update);
    player.addEventListener("seeked", update);
    return () => { player.removeEventListener("timeupdate", update); player.removeEventListener("seeked", update); };
  }, [video, items, media]);

  useEffect(() => {          // keep the playing phrase visible inside the box, without scrolling the page
    const box = list.current;
    const row = box?.querySelector<HTMLElement>(".phrase.playing");
    if (box && row && (row.offsetTop < box.scrollTop || row.offsetTop > box.scrollTop + box.clientHeight - 40)) {
      box.scrollTop = row.offsetTop - 24;          // .phrases is position: relative, so offsetTop is inside it
    }
  }, [active]);

  if (items === null) return <p className="muted small">กำลังโหลดบทพูด…</p>;
  const fillers = items.filter((i) => i.is_filler).length;
  const pauses = items.filter((i) => i.pause_after_s != null).length;
  return (
    <details className="transcript">
      <summary>บทพูดที่ถอดเสียง <span className="muted small">
        {items.length ? `· เสียงเติม ${fillers} · หยุดยาว ${pauses}` : ""}</span></summary>
      {items.length === 0 ? <p className="muted">ไม่มีบทพูดสำหรับรอบนี้</p> : <>
        <p className="muted small">กดข้อความเพื่อไปยังช่วงนั้นในวิดีโอ · <mark className="filler-key">เสียงเติม</mark> (S3) ·
          <span className="pause-key"> ⏸ หยุดยาว</span> (S2) · ข้อความจากระบบถอดเสียงอาจสะกดผิด</p>
        <ol ref={list} className="phrases">
          {items.map((item, i) => <li key={i}>
            <button type="button" className={`phrase${item.is_filler ? " filler" : ""}${i === active ? " playing" : ""}`}
              disabled={media !== "ready"} aria-current={i === active ? "true" : undefined}
              aria-label={`${fmtTime(item.start_s)} ${item.text}${item.is_filler ? " (เสียงเติม)" : ""}`}
              onClick={() => seek(item.start_s)}>
              {item.is_filler ? <mark>{item.text}</mark> : item.text}
            </button>
            {item.pause_after_s != null && <span className="pause-tag">⏸ เงียบ {item.pause_after_s.toFixed(1)} วินาที</span>}
          </li>)}
        </ol>
      </>}
    </details>
  );
}
