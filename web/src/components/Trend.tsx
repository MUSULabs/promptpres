// D-046 layer 3: change in levels across rehearsals (observed change, not skill progress — PROJECT_SCOPE)
// — one row per criterion, never summed into one number.
import { Link } from "react-router-dom";
import type { CriterionCode, SessionRow } from "../contract";
import { CRITERION_NAME, SKILLS } from "../presentation";
import { direction, doneRuns, finishedRuns, compatibleRubric, MIXED_RUBRIC_NOTE, type Direction } from "../trend";

const ARROW: Record<Exclude<Direction, null>, [string, string]> = {
  up: ["↑", "ดีขึ้นจากรอบก่อน"], same: ["=", "คงที่"], down: ["↓", "ลดลงจากรอบก่อน"],
};
const MAX_RUNS = 6;

function LevelChip({ level }: { level: number | null | undefined }) {
  return level == null ? <span className="chip chip-na" title="วิเคราะห์ไม่ได้">–</span>
    : <span className={`chip chip-${level}`}>{level}</span>;
}

/** Level-change panel on the history page: shown from 2 finished rehearsals with comparable rubric versions. */
export function TrendPanel({ rows }: { rows: SessionRow[] }) {
  const all = finishedRuns(rows);
  if (all.length < 2) return null;
  const rubric = all[all.length - 1].rubric_version;
  const same = all.filter((r) => compatibleRubric(r.rubric_version, rubric));
  const runs = same.slice(-MAX_RUNS);
  if (runs.length < 2) return null;
  const left_out = doneRuns(rows).length - same.length;
  const codes: CriterionCode[] = SKILLS.flatMap((s) => s.codes);
  const trend = Object.fromEntries(codes.map((code) =>
    [code, direction(runs[runs.length - 2].levels?.[code], runs[runs.length - 1].levels?.[code])])) as Record<CriterionCode, Direction>;
  const improved = codes.filter((code) => trend[code] === "up");
  return (
    <section className="panel trend" aria-labelledby="trend-title">
      <div className="section-heading">
        <h2 id="trend-title">แนวโน้มผลการฝึกซ้อมข้ามรอบ</h2>
        <span className="tag">รอบก่อน → รอบล่าสุด ({runs.length} รอบ)</span>
      </div>
      <p className="muted small">เทียบระดับของเกณฑ์เดียวกันระหว่างรอบ ไม่รวมเป็นคะแนนเดียว · – = วิเคราะห์ไม่ได้
        {same.length > runs.length && ` · แสดง ${MAX_RUNS} รอบล่าสุด`}
        {left_out > 0 && ` · ไม่นับ ${left_out} รอบที่ใช้เกณฑ์รุ่นอื่นหรือชุดเกณฑ์ต่างกัน (ยังเปิดดูได้จากรายการรอบซ้อม)`}</p>
      {improved.length > 0 && <p className="trend-summary"><strong>ดีขึ้นจากรอบก่อน ↑</strong> {improved.map((code) =>
        <span key={code} className="tag">{code} {CRITERION_NAME[code]}</span>)}</p>}
      <div className="trend-scroll">
        <table className="trend-table">
          <thead><tr>
            <th scope="col">เกณฑ์</th>
            {runs.map((r, i) => <th scope="col" key={r.session_id}>
              <Link to={`/sessions/${r.session_id}`} title={new Date(r.created_at).toLocaleString("th-TH")}>
                {i === runs.length - 1 ? "ล่าสุด" : `รอบ ${same.length - runs.length + i + 1}`}</Link>
            </th>)}
            <th scope="col">การเปลี่ยนแปลง</th>
          </tr></thead>
          <tbody>{codes.map((code) => {
            const t = trend[code];
            return <tr key={code}>
              <th scope="row"><span className="code">{code}</span> {CRITERION_NAME[code]}</th>
              {runs.map((r) => <td key={r.session_id}><LevelChip level={r.levels?.[code]} /></td>)}
              <td className={`trend-dir ${t ?? "na"}`}>{t ? `${ARROW[t][0]} ${ARROW[t][1]}` : "เทียบไม่ได้"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="muted small">{new Set(runs.map((r) => r.rubric_version)).size > 1 ? MIXED_RUBRIC_NOTE : "เปรียบเทียบระดับรายเกณฑ์ที่ระบบวัดได้ระหว่างรอบซ้อมที่ใช้เกณฑ์รุ่นเดียวกัน"}</p>
    </section>
  );
}

/** Small badge on a result card: this level vs the previous comparable rehearsal. The cross-version
 *  note is printed once above the cards (ResultPage); the title repeats it on the badge. */
export function DeltaBadge({ before, now, crossVersion }: { before: number | null; now: number | null; crossVersion?: boolean }) {
  const d = direction(before, now);
  if (!d) return null;
  const text = d === "same" ? `= คงที่ (ระดับ ${now})`
    : `${ARROW[d][0]} ${ARROW[d][1]} (ระดับ ${before} → ${now})`;
  return <span className={`delta delta-${d}`} title={crossVersion ? MIXED_RUBRIC_NOTE : undefined}>{text}</span>;
}
