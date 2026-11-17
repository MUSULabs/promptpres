import { useId } from "react";
import type { Criterion } from "../contract";
import { CRITERION_NAME, SKILLS } from "../presentation";

const CODES = SKILLS.flatMap((s) => s.codes);
const point = (i: number, radius: number) => {
  const angle = i * Math.PI / 4 - Math.PI / 2;
  return { x: 180 + Math.cos(angle) * radius, y: 180 + Math.sin(angle) * radius };
};
export default function SkillRadar({ criteria }: { criteria: Criterion[] }) {
  const id = useId();
  const cards = CODES.map((code) => criteria.find((c) => c.code === code));
  const levels = cards.map((c) => c?.status === "ok" ? c.level : null);
  const measured = levels.filter((n) => n != null).length;
  const good = cards.filter((c) => c?.status === "ok" && c.level != null && c.level >= 3);
  const focus = cards.filter((c) => c?.status === "ok" && c.level != null && c.level <= 2);
  return <section className="panel skill-profile" aria-labelledby={`${id}-title`}>
    <div><h2 id={`${id}-title`}>โปรไฟล์ทักษะ 8 เกณฑ์</h2>
      <svg viewBox="0 0 360 360" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <desc id={`${id}-desc`}>กราฟระดับรายเกณฑ์ 1 ถึง 4 จุดโปร่งนอกวงระดับหมายถึงวิเคราะห์ไม่ได้ ไม่มีค่าระดับและไม่รวมในสรุป</desc>
        {[1, 2, 3, 4].map((level) => <g key={level}><polygon fill="none" stroke="var(--radar-grid, #cbd5e1)"
          points={CODES.map((_, i) => { const p = point(i, level * 29); return `${p.x},${p.y}`; }).join(" ")} />
          <text x={184} y={180 - level * 29} fontSize="11">{level}</text></g>)}
        {CODES.map((code, i) => {
          const tip = point(i, 116), label = point(i, 154), level = levels[i];
          const p = point(i, level == null ? 134 : level * 29);
          const next = (i + 1) % 8, nextLevel = levels[next];
          const q = point(next, (nextLevel ?? 0) * 29);
          return <g key={code} data-criterion={code} data-level={level ?? "unanalyzable"}>
            <line x1={180} y1={180} x2={tip.x} y2={tip.y} stroke="#cbd5e1" />
            {level != null && nextLevel != null && <line className="radar-edge" x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#2563eb" strokeWidth={2.5} />}
            <circle cx={p.x} cy={p.y} r={5} fill={level == null ? "#64748b" : "#2563eb"} fillOpacity={level == null ? 0.15 : 1} stroke={level == null ? "#64748b" : "#2563eb"} strokeWidth={2} />
            <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" fontSize="13">{code}</text>
          </g>;
        })}
      </svg>
    </div><div>
      <p className="radar-summary">{measured ? `ระดับดี–ดีมาก ${good.length} จาก ${measured} เกณฑ์ที่วิเคราะห์ได้` : "รอบนี้ยังไม่มีเกณฑ์ที่วิเคราะห์ได้"}</p>
      {good.length > 0 && <p><strong>จุดเด่น:</strong> {good.map((c) => CRITERION_NAME[c!.code]).join(" · ")}</p>}
      {focus.length > 0 && <p><strong>ให้ความสำคัญรอบถัดไป:</strong> {focus.map((c) => CRITERION_NAME[c!.code]).join(" · ")}</p>}
      <p className="muted small">จุดโปร่งนอกวงระดับ = วิเคราะห์ไม่ได้ ไม่นำมาคิดระดับ · ผลแยกรายเกณฑ์ ไม่มีคะแนนรวม</p>
      <ul className="radar-values">{CODES.map((code, i) => <li key={code}>{code} {CRITERION_NAME[code]}: {levels[i] == null ? "วิเคราะห์ไม่ได้" : `ระดับ ${levels[i]}`}</li>)}</ul>
    </div></section>;
}
