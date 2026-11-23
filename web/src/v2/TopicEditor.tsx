/* Edit the topic list before practising: rename, write the key point, add, delete, move up / down (no drag and
   drop, D-040). Focus follows the row that moved, so a keyboard user can keep pressing the same arrow. */
import { useRef } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { DraftTopic, TopicLimits } from "@/contract";
import { Button, cn } from "./ui";

let nextId = 0;

export function TopicEditor({ topics, limits, onChange, disabled }: { topics: DraftTopic[]; limits: TopicLimits; onChange: (t: DraftTopic[]) => void; disabled?: boolean }) {
  // row keys that travel with each topic (index keys left focus on the old position after a move)
  const ids = useRef<number[]>([]);
  if (ids.current.length !== topics.length) ids.current = topics.map(() => nextId++);
  const box = useRef<HTMLFieldSetElement>(null);

  /** After React has drawn the change, put focus on `selector` inside the editor (or `fallback`). */
  function focusLater(selector: string, fallback?: string) {
    requestAnimationFrame(() => {
      const root = box.current;
      const target = root?.querySelector<HTMLElement>(`${selector}:not(:disabled)`) ?? (fallback ? root?.querySelector<HTMLElement>(fallback) : null);
      target?.focus();
    });
  }
  const set = (i: number, patch: Partial<DraftTopic>) => onChange(topics.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= topics.length) return;
    const next = [...topics]; [next[i], next[j]] = [next[j], next[i]];
    const order = [...ids.current]; [order[i], order[j]] = [order[j], order[i]];
    ids.current = order;
    onChange(next);
    const row = `[data-topic="${order[j]}"]`;
    focusLater(`${row} [data-move="${d}"]`, `${row} [data-move="${-d}"]`); // the same arrow, or the other one at an end
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
  const ok = topics.length >= limits.min && topics.length <= limits.max;
  const tool = "grid size-10 place-items-center rounded-lg text-muted hover:bg-surface hover:text-brand disabled:opacity-30";

  return <fieldset ref={box} disabled={disabled} className="mt-4 min-w-0">
    <legend className="sr-only">แก้ไขหัวข้อที่จะนำเสนอ</legend>
    <ol className="space-y-2.5">
      {topics.map((t, i) => <li key={ids.current[i]} data-topic={ids.current[i]} className="flex gap-2 rounded-2xl bg-surface p-2.5 sm:gap-3 sm:p-3">
        <span aria-hidden className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-xs font-bold text-white">{i + 1}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <label className="block">
            <span className="sr-only">ชื่อหัวข้อที่ {i + 1}</span>
            <input value={t.title} onChange={(e) => set(i, { title: e.target.value })} placeholder={`ชื่อหัวข้อที่ ${i + 1}`} maxLength={200}
              className="h-11 w-full rounded-xl bg-white px-3 text-sm font-semibold outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-brand" />
          </label>
          <label className="block">
            <span className="sr-only">ใจความสำคัญหัวข้อที่ {i + 1}</span>
            <textarea rows={2} value={t.key_point} onChange={(e) => set(i, { key_point: e.target.value })} placeholder="ใจความสำคัญ (ไม่บังคับ)" maxLength={500}
              className="block w-full resize-y rounded-xl bg-white px-3 py-2 text-sm outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-brand" />
          </label>
        </div>
        <div className="flex shrink-0 flex-col">
          <button type="button" data-move="-1" aria-label={`เลื่อนหัวข้อที่ ${i + 1} ขึ้น`} title="เลื่อนขึ้น" disabled={i === 0} onClick={() => move(i, -1)} className={tool}><ArrowUp className="size-4" /></button>
          <button type="button" data-move="1" aria-label={`เลื่อนหัวข้อที่ ${i + 1} ลง`} title="เลื่อนลง" disabled={i === topics.length - 1} onClick={() => move(i, 1)} className={tool}><ArrowDown className="size-4" /></button>
          <button type="button" aria-label={`ลบหัวข้อที่ ${i + 1}`} title="ลบหัวข้อ" onClick={() => remove(i)} className={tool}><X className="size-4" /></button>
        </div>
      </li>)}
    </ol>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" variant="soft" data-add-topic="" disabled={topics.length >= limits.max} title={topics.length >= limits.max ? `ใส่ได้สูงสุด ${limits.max} หัวข้อ` : undefined} onClick={add}><Plus />เพิ่มหัวข้อ</Button>
      <span className={cn("text-xs", ok ? "text-muted" : "font-semibold text-ink")}>{topics.length} หัวข้อ (ต้องมี {limits.min}–{limits.max} หัวข้อ)</span>
    </div>
  </fieldset>;
}
