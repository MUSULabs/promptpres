/* /how: how each of the 8 criteria is measured. Plain-language readings and level texts come from the API
   (GET /api/criteria = config/feedback-v0.yaml interpret); "needs" lines from config/thresholds-v0.yaml
   unanalyzable blocks. No new numbers are invented here. */
import { createContext, useContext, useEffect, useState } from "react";
import { CircleHelp, Ban, RefreshCw } from "lucide-react";
import { api } from "@/api";
import type { CriteriaMeta, CriterionCode } from "@/contract";
import { ErrorPanel } from "@/v2/states";
import { Button } from "@/v2/ui";
import { CRITERION_NAME, SKILLS } from "@/presentation";
import { SKILL_STYLE, SkillIcon, cn } from "@/v2/ui";
import { ContentPage, type Section } from "@/v2/ContentPage";
import { LEVEL_COLOR } from "@/v2/viz";

/** null = loading, "error" = failed (the measuring facts still show; only the level wording is missing) */
const Meta = createContext<CriteriaMeta | null | "error">(null);

const FROM: Record<CriterionCode, { from: string; needs: string }> = {
  C1: { from: "ลำดับที่แต่ละหัวข้อถูกอธิบายครั้งแรก เทียบกับลำดับในแผนที่คุณยืนยัน", needs: "หัวข้อที่อธิบายชัดอย่างน้อย 3 หัวข้อจึงแสดงค่า และ 4 หัวข้อจึงให้ระดับ" },
  C2: { from: "AI อ่านข้อความที่ถอดจากเสียงเทียบกับหัวข้อในแผน แล้วระบบตรวจว่าข้อความที่ AI อ้างมีอยู่จริง", needs: "ยืนยันหัวข้ออย่างน้อย 3 หัวข้อ และพูดจริงอย่างน้อย 30 วินาที" },
  S1: { from: "นับพยางค์จากข้อความที่ถอดเสียง หารด้วยเวลาที่พูดจริง", needs: "ช่วงพูดจริงอย่างน้อย 30 วินาที" },
  S2: { from: "หาช่วงเงียบจากคลื่นเสียง นับครั้งที่เงียบนานเกินเกณฑ์ต่อนาที", needs: "ช่วงพูดจริงอย่างน้อย 30 วินาที" },
  S3: { from: "นับเสียงเติม (เอ่อ อ่า อืม) และคำติดปากตามบริบท เช่น แบบว่า ต่อนาที", needs: "ช่วงพูดจริงอย่างน้อย 30 วินาที" },
  N1: { from: "ตำแหน่งข้อมือในแต่ละช่วงเวลา หาช่วงที่มือนิ่งค้างต่อเนื่องนาน", needs: "เห็นมือในกล้องอย่างน้อย 70% ของเวลา" },
  N2: { from: "ทิศทางศีรษะทุก 1 วินาที: ก้ม หันข้าง เงยหรืออื่น ๆ หรือหันตรง", needs: "เห็นใบหน้าอย่างน้อย 70% ของเวลา" },
  T1: { from: "ช่วงตั้งแต่เริ่มพูดถึงพูดจบ เทียบกับเวลาเป้าหมายที่คุณตั้ง", needs: "ต้องตั้งเวลาเป้าหมาย" },
};

function CriterionCard({ code }: { code: CriterionCode }) {
  const meta = useContext(Meta);
  const m = meta && meta !== "error" ? meta[code]?.interpret : undefined;
  return <div id={code} className="scroll-mt-24 rounded-2xl bg-surface p-5">
    <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-brand px-2 py-0.5 text-xs font-bold text-white">{code}</span><b className="text-lg text-ink">{CRITERION_NAME[code]}</b></div>
    {m?.explain && <p className="mt-2">{m.explain}</p>}
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <div className="rounded-xl bg-white p-3"><dt className="text-xs font-semibold text-brand">วัดจาก</dt><dd className="mt-0.5 text-ink">{FROM[code].from}</dd></div>
      <div className="rounded-xl bg-white p-3"><dt className="text-xs font-semibold text-brand">ต้องมีอะไร (ไม่งั้นวิเคราะห์ไม่ได้)</dt><dd className="mt-0.5 text-ink">{FROM[code].needs}</dd></div>
    </dl>
    {m?.levels && <ol className="!mt-3 !list-none !space-y-1.5 !pl-0">
      {[4, 3, 2, 1].map((lv) => m.levels?.[String(lv)] && <li key={lv} className="flex items-start gap-3 text-sm">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold", lv >= 3 ? "text-white" : "text-brand-800")} style={{ background: LEVEL_COLOR[lv] }}>{lv}</span>
        <span className="pt-1 text-ink">{m.levels[String(lv)]}</span>
      </li>)}
    </ol>}
  </div>;
}

const SECTIONS: Section[] = [
  { id: "levels", title: "อ่านผลอย่างไร", body: <>
    <p>แต่ละเกณฑ์ได้ <b>ระดับ 1–4</b> จากเกณฑ์ตัวเลขที่เขียนไว้ในระบบ (ไม่มี AI ตัดสินระดับ) และมีเวลาในวิดีโอให้กดดูหลักฐานเสมอ</p>
    <div className="flex flex-wrap gap-2">
      {[1, 2, 3, 4].map((lv) => <span key={lv} className={cn("rounded-xl px-3 py-2 text-sm font-semibold", lv >= 3 ? "text-white" : "text-brand-800")} style={{ background: LEVEL_COLOR[lv] }}>ระดับ {lv}</span>)}
      <span className="flex items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-faint px-3 py-2 text-sm font-semibold text-faint"><CircleHelp className="size-4" />วิเคราะห์ไม่ได้</span>
    </div>
    <p><b>"วิเคราะห์ไม่ได้" ไม่ใช่ระดับ 1</b> แปลว่าระบบมีข้อมูลไม่พอจะวัดอย่างยุติธรรม การ์ดจะบอกเหตุผลเสมอ</p>
    <p>เกณฑ์ตัวเลขทั้งหมดยังเป็นร่าง (รูบริก v0.9) อยู่ระหว่างตรวจความเที่ยงตรงกับผู้เชี่ยวชาญ</p>
  </> },
  ...SKILLS.map((s) => ({ id: s.key, title: `${s.label}: ${SKILL_STYLE[s.key].tagline}`, body: <div className="space-y-3">
    <div className="flex items-center gap-3"><SkillIcon skill={s.key} /><span>{s.codes.length} เกณฑ์</span></div>
    {s.codes.map((c) => <CriterionCard key={c} code={c} />)}
  </div> })),
  { id: "not", title: "สิ่งที่ไม่ได้วัด", body: <ul className="!list-none !pl-0">
    {["อารมณ์ ความมั่นใจ ความตื่นเต้น หรือบุคลิกภาพ", "การสบตา (N2 ดูแค่ทิศทางศีรษะ)", "ความหมายของท่ามือ หรือท่ามือซ้ำ ๆ", "การโยกตัว", "ความถูกต้องของเนื้อหาวิชาการ"].map((t) =>
      <li key={t} className="flex items-center gap-3"><Ban className="size-4 shrink-0 text-brand" />{t}</li>)}
  </ul> },
];

export default function How() {
  const [meta, setMeta] = useState<CriteriaMeta | null | "error">(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setMeta(null);
    api.criteria(c.signal).then(setMeta).catch(() => { if (!c.signal.aborted) setMeta("error"); });
    return () => c.abort();
  }, [attempt]);
  return <Meta.Provider value={meta}><ContentPage eyebrow="เราวัดผลอย่างไร" title={<>ทุกระดับ <span className="text-lime">ตรวจสอบได้</span> ย้อนดูได้ในวิดีโอ</>}
    intro="8 เกณฑ์ใน 4 ทักษะ วัดจากอะไร ระดับแต่ละขั้นหมายความว่าอะไร และเมื่อไรระบบจะบอกว่าวิเคราะห์ไม่ได้" sections={SECTIONS}>
    {meta === "error" && <ErrorPanel tone="info" what="โหลดคำอธิบายระดับไม่สำเร็จ" why="วิธีวัดและเงื่อนไขยังแสดงครบ แต่คำอ่านของแต่ละระดับยังไม่ขึ้น"
      actions={<Button size="sm" variant="soft" onClick={() => setAttempt((n) => n + 1)}><RefreshCw />ลองใหม่</Button>} />}
  </ContentPage></Meta.Provider>;
}
