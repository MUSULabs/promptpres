import { useRef } from "react";
import type { DraftTopic, TopicLimits } from "../contract";
import { Icon } from "./ui";

let nextId = 0;

/** Edit the topic list: rename, write the key point, add, delete, move up / down. No drag and drop (D-040). */
export default function TopicEditor({ topics, limits, onChange }: { topics: DraftTopic[]; limits: TopicLimits; onChange: (t: DraftTopic[]) => void }) {
  // Row keys that travel with each topic (index keys left focus on the old position after a move).
  const ids = useRef<number[]>([]);
  if (ids.current.length !== topics.length) ids.current = topics.map(() => nextId++);
  const list = useRef<HTMLOListElement>(null);

  /** After React has drawn the change, put focus on `selector` inside the list (or `fallback`). */
  function focusLater(selector: string, fallback?: string) {
    requestAnimationFrame(() => {
      const root = list.current?.parentElement;
      const target = root?.querySelector<HTMLElement>(`${selector}:not(:disabled)`)
        ?? (fallback ? root?.querySelector<HTMLElement>(fallback) : null);
      target?.focus();
    });
  }

  function set(i: number, patch: Partial<DraftTopic>) {
    onChange(topics.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= topics.length) return;
    const next = [...topics];
    [next[i], next[j]] = [next[j], next[i]];
    const order = [...ids.current];
    [order[i], order[j]] = [order[j], order[i]];
    ids.current = order;
    onChange(next);
    const row = `[data-topic="${order[j]}"]`;
    focusLater(`${row} [data-move="${d}"]`, `${row} [data-move="${-d}"]`);   // the same arrow, or the other at an end
  }
  function remove(i: number) {
    ids.current = ids.current.filter((_, j) => j !== i);
    const neighbour = ids.current[Math.min(i, ids.current.length - 1)];
    onChange(topics.filter((_, j) => j !== i));
    focusLater(neighbour == null ? "[data-add-topic]" : `[data-topic="${neighbour}"] input`, "[data-add-topic]");
  }
  function add() {
    ids.current = [...ids.current, nextId++];
    onChange([...topics, { title: "", key_point: "" }]);
    focusLater(`[data-topic="${ids.current[ids.current.length - 1]}"] input`);
  }

  return (
    <div className="topic-editor">
      <ol ref={list}>
        {topics.map((t, i) => (
          <li key={ids.current[i]} className="topic-row" data-topic={ids.current[i]}>
            <span className="topic-number" aria-hidden="true">{i + 1}</span>
            <div className="topic-fields">
              <label><span>ชื่อหัวข้อ<span className="sr-only">ที่ {i + 1}</span></span>
                <input value={t.title} onChange={(e) => set(i, { title: e.target.value })} />
              </label>
              <label><span>ใจความสำคัญ<span className="sr-only">หัวข้อที่ {i + 1}</span></span>
                <textarea rows={2} value={t.key_point} onChange={(e) => set(i, { key_point: e.target.value })} />
              </label>
            </div>
            <div className="topic-tools">
              <button type="button" className="ghost" data-move="-1" aria-label={`เลื่อนหัวข้อที่ ${i + 1} ขึ้น`} title="เลื่อนขึ้น" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevronUp" /></button>
              <button type="button" className="ghost" data-move="1" aria-label={`เลื่อนหัวข้อที่ ${i + 1} ลง`} title="เลื่อนลง" disabled={i === topics.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" /></button>
              <button type="button" className="ghost danger-text" aria-label={`ลบหัวข้อที่ ${i + 1}`} title="ลบหัวข้อ" onClick={() => remove(i)}><Icon name="close" /></button>
            </div>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" className="ghost" data-add-topic="" disabled={topics.length >= limits.max} onClick={add}><Icon name="plus" /> เพิ่มหัวข้อ</button>
        <span className={topics.length < limits.min ? "error" : "muted"}>
          {topics.length} หัวข้อ (ต้องมี {limits.min}–{limits.max} หัวข้อ)
        </span>
      </div>
    </div>
  );
}
