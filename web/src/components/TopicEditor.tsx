import type { DraftTopic, TopicLimits } from "../contract";
import { Icon } from "./ui";

/** Edit the topic list: rename, write the key point, add, delete, move up / down. No drag and drop (D-040). */
export default function TopicEditor({ topics, limits, onChange }: { topics: DraftTopic[]; limits: TopicLimits; onChange: (t: DraftTopic[]) => void }) {
  function set(i: number, patch: Partial<DraftTopic>) {
    onChange(topics.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= topics.length) return;
    const next = [...topics];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  const remove = (i: number) => onChange(topics.filter((_, j) => j !== i));
  const add = () => onChange([...topics, { title: "", key_point: "" }]);

  return (
    <div className="topic-editor">
      <ol>
        {topics.map((t, i) => (
          <li key={i} className="topic-row">
            <span className="topic-number" aria-hidden="true">{i + 1}</span>
            <div className="topic-fields">
              <input aria-label={`ชื่อหัวข้อที่ ${i + 1}`} placeholder="ชื่อหัวข้อ" value={t.title}
                onChange={(e) => set(i, { title: e.target.value })} />
              <textarea aria-label={`ใจความสำคัญหัวข้อที่ ${i + 1}`} rows={2}
                placeholder="ใจความสำคัญ (ช่วยให้ระบบตรวจว่าอธิบายครบ)" value={t.key_point}
                onChange={(e) => set(i, { key_point: e.target.value })} />
            </div>
            <div className="topic-tools">
              <button type="button" className="ghost" aria-label={`เลื่อนหัวข้อที่ ${i + 1} ขึ้น`} title="เลื่อนขึ้น" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="ghost" aria-label={`เลื่อนหัวข้อที่ ${i + 1} ลง`} title="เลื่อนลง" disabled={i === topics.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="ghost danger-text" aria-label={`ลบหัวข้อที่ ${i + 1}`} title="ลบหัวข้อ" onClick={() => remove(i)}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" className="ghost" disabled={topics.length >= limits.max} onClick={add}><Icon name="plus" /> เพิ่มหัวข้อ</button>
        <span className={topics.length < limits.min ? "error" : "muted"}>
          {topics.length} หัวข้อ (ต้องมี {limits.min}–{limits.max} หัวข้อ)
        </span>
      </div>
    </div>
  );
}
