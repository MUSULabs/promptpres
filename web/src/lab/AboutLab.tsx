/* /lab/about: what PromptPre's is, why it exists, the 8 criteria, honest limits, the team (placeholder names). */
import { Link } from "react-router-dom";
import { GraduationCap, Microscope, Users } from "lucide-react";
import { CRITERION_NAME, SKILLS } from "@/presentation";
import { Button, SKILL_STYLE, SkillIcon } from "@/v2/ui";
import { ContentPage, type Section } from "@/v2/ContentPage";
import { PPre } from "@/v2/PPre";

const SECTIONS: Section[] = [
  { id: "what", title: "PromptPre's คืออะไร", body: <div className="grid items-center gap-6 sm:grid-cols-[1fr_auto]">
    <div className="space-y-3">
      <p>PromptPre's (พร้อมพรีต์) คือเวทีซ้อมนำเสนอออนไลน์ อัดคลิปตอนซ้อม แล้วระบบจะบอกว่า <b>เกิดอะไรขึ้นจริงในคลิป</b> เช่น พูดเร็วแค่ไหน หยุดยาวกี่ครั้ง พูดครบหัวข้อไหม พร้อมเวลาในวิดีโอให้กดดูหลักฐานได้ทุกจุด</p>
      <p>ไม่มีคะแนนรวม ไม่มีเกรด เพราะเราอยากให้คุณเห็นว่า <b>ควรซ้อมตรงไหนต่อ</b> ไม่ใช่รู้สึกว่าถูกตัดสิน</p>
    </div>
    <PPre pose="wave" size={120} className="mx-auto" />
  </div> },
  { id: "why", title: "ทำไมถึงสร้างขึ้นมา", body: <p>นักศึกษาส่วนใหญ่ซ้อมพรีเซนต์คนเดียว ไม่มีใครบอกว่าพูดเร็วไป หรือลืมหัวข้อไหน การดูคลิปตัวเองก็ไม่รู้จะดูอะไร โครงงานนี้จึงแปลงคลิปซ้อมเป็นข้อมูลที่ <b>วัดได้ ตรวจสอบได้ และชี้กลับไปที่วิดีโอ</b> เพื่อให้รอบถัดไปรู้ว่าจะปรับอะไร</p> },
  { id: "criteria", title: "8 เกณฑ์ใน 4 ทักษะ", body: <div className="grid gap-3 sm:grid-cols-2">
    {SKILLS.map((s) => <div key={s.key} className="rounded-2xl bg-surface p-4">
      <div className="flex items-center gap-3"><SkillIcon skill={s.key} /><div><b className="block text-ink">{s.label}</b><span className="text-xs">{SKILL_STYLE[s.key].tagline}</span></div></div>
      <ul className="mt-3 !space-y-1 text-sm">{s.codes.map((c) => <li key={c}><b>{c}</b> {CRITERION_NAME[c]}</li>)}</ul>
    </div>)}
    <p className="sm:col-span-2"><Link to="/lab/how">อ่านว่าแต่ละเกณฑ์วัดอย่างไร →</Link></p>
  </div> },
  { id: "limits", title: "สิ่งที่ระบบทำไม่ได้ (บอกตรง ๆ)", body: <ul>
    <li>ไม่วัดอารมณ์ ความมั่นใจ ความตื่นเต้น หรือบุคลิกภาพ</li>
    <li>ไม่วัด <b>การสบตา</b> เกณฑ์ N2 ดูแค่ทิศทางศีรษะเทียบกล้อง</li>
    <li>ไม่ตีความ <b>ความหมาย</b> ของท่ามือ ดูแค่ช่วงที่มือนิ่งค้างนาน</li>
    <li>ถ้ามองไม่เห็นหรือได้ยินไม่ชัด การ์ดจะขึ้น "วิเคราะห์ไม่ได้" พร้อมเหตุผล ไม่เดาเป็นระดับ 1</li>
    <li>เกณฑ์ตัวเลขยังเป็นร่าง (รูบริก v0.9) อยู่ระหว่างตรวจความเที่ยงตรงกับผู้เชี่ยวชาญ</li>
  </ul> },
  { id: "team", title: "ทีมผู้พัฒนา", body: <>
    <div className="grid gap-3 sm:grid-cols-3">
      {[[Users, "ผู้พัฒนา", "ชื่อทีมผู้พัฒนา"], [GraduationCap, "อาจารย์ที่ปรึกษา", "ชื่ออาจารย์ที่ปรึกษา"], [Microscope, "สาขา", "วิทยาการคอมพิวเตอร์ มหาวิทยาลัยพะเยา"]].map(([I, k, v]) => { const Icon = I as typeof Users;
        return <div key={k as string} className="rounded-2xl bg-surface p-4"><Icon className="size-5 text-brand" /><p className="mt-2 text-xs">{k as string}</p><b className="text-ink">{v as string}</b></div>; })}
    </div>
    <p className="text-xs text-faint">ข้อความตัวอย่าง รอชื่อจริงจากเจ้าของโปรเจกต์</p>
  </> },
];

export default function AboutLab() {
  return <ContentPage eyebrow="เกี่ยวกับ" title={<>เวทีซ้อมที่บอกว่า<span className="text-lime">เกิดอะไรขึ้นจริง</span>ในคลิปของคุณ</>}
    intro="โครงงานวิทยาการคอมพิวเตอร์ มหาวิทยาลัยพะเยา ปีการศึกษา 2569" sections={SECTIONS}>
    <div className="rounded-panel bg-brand-gradient p-8 text-center text-white shadow-glow">
      <p className="text-2xl font-bold">ลองซ้อมรอบแรกดูไหม?</p>
      <p className="mt-1 text-white/75">ไม่ต้องสมัคร ใช้แบบ Guest ได้ทันที</p>
      <Button asChild variant="lime" size="lg" className="mt-5"><Link to="/lab/login">เริ่มใช้งานฟรี</Link></Button>
    </div>
  </ContentPage>;
}
