/* /privacy: privacy notice + terms in plain Thai, written from what the system really does
   (CLAUDE.md D-050/D-062, config/storage-v0.yaml, worker/llm/*). DRAFT: the owner and advisor review it before real use. */
import { Link } from "react-router-dom";
import { Bot, Clock3, Cookie, Database, Eye, FileText, Mic, Server, ShieldCheck, Video } from "lucide-react";
import { ContentPage, type Section } from "@/v2/ContentPage";
import { PATH } from "@/v2/paths";

const COLLECT = [
  { Icon: Video, t: "วิดีโอซ้อม", d: "ใช้วัดการพูด มือ ทิศทางศีรษะ และเวลา หลังวิเคราะห์ระบบเก็บไว้แค่ฉบับย่อ (ไม่เกิน 480p) เพื่อให้คุณกดดูหลักฐาน" },
  { Icon: FileText, t: "ไฟล์ PDF รายงาน/สไลด์", d: "ใช้ดึงหัวข้อที่คุณวางแผนจะพูด (ไม่บังคับ)" },
  { Icon: Mic, t: "ข้อความที่ถอดจากเสียงพูด", d: "ระบบถอดเสียงเป็นข้อความบนเครื่องวิเคราะห์ที่โครงงานเช่าไว้ (Modal ในสหรัฐอเมริกา) ไม่ได้ส่งเสียงให้บริการอื่น ใช้นับเสียงเติมและตรวจว่าพูดครบหัวข้อ" },
  { Icon: Database, t: "ผลการวิเคราะห์และบัญชี", d: "ระดับ 8 เกณฑ์ ค่าที่วัดได้ เวลาหลักฐาน และอีเมลกับชื่อที่แสดง (สมาชิก) รหัสผ่านเก็บแบบเข้ารหัสทางเดียว อ่านย้อนกลับไม่ได้" },
];

const SECTIONS: Section[] = [
  { id: "summary", title: "สรุปสั้น ๆ", body: <ul>
    <li>เราใช้ข้อมูลของคุณเพื่อ <b>วิเคราะห์การซ้อมนำเสนอและแสดงผลให้คุณเห็น</b> เท่านั้น ไม่ขาย ไม่ใช้โฆษณา</li>
    <li>วิดีโอของ Guest ถูกลบหลัง <b>7 วัน</b> ของสมาชิกหลัง <b>30 วัน</b></li>
    <li>AI ได้รับ <b>ข้อความ</b> (จาก PDF และจากเสียงพูด) ไม่เคยได้รับวิดีโอหรือเสียงของคุณ</li>
    <li>เราใช้คุกกี้เพียงตัวเดียว คือคุกกี้เข้าสู่ระบบ ไม่มีคุกกี้ติดตามหรือโฆษณา</li>
    <li>ระบบไม่วัดและไม่อนุมานอารมณ์ ความมั่นใจ บุคลิกภาพ การสบตา หรือความหมายของท่ามือ</li>
  </ul> },
  { id: "collect", title: "เราเก็บข้อมูลอะไร", body: <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {COLLECT.map(({ Icon, t, d }) => <div key={t} className="rounded-2xl bg-surface p-4">
      <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand"><Icon className="size-[18px]" /></span>
      <b className="mt-3 block">{t}</b><p className="mt-1 text-sm">{d}</p>
    </div>)}
  </div> },
  { id: "ai", title: "ส่งอะไรให้ AI บ้าง", body: <>
    <p>บางส่วนของการวิเคราะห์ใช้โมเดลภาษา (AI) ผ่านบริการ OpenRouter ซึ่งส่งต่อไปยังผู้ให้บริการโมเดลที่โครงงานเลือกไว้ <b>สิ่งที่ส่งมีแค่ข้อความ</b>:</p>
    <ol>
      <li><b>ข้อความใน PDF</b> เพื่อเสนอรายการหัวข้อให้คุณตรวจและแก้ก่อนใช้</li>
      <li><b>หัวข้อที่คุณยืนยัน และข้อความที่ถอดจากเสียงพูด</b> เพื่อตรวจว่าแต่ละหัวข้อถูกอธิบายชัดแค่ไหน (เกณฑ์ C2) ระบบตรวจซ้ำว่าข้อความที่ AI อ้างมีอยู่จริง</li>
      <li><b>ผล 8 เกณฑ์ หัวข้อที่คุณยืนยันพร้อมข้อความที่ตรวจแล้วว่าพูดจริง และข้อความสั้น ๆ รอบจุดหลักฐาน</b> (ไม่เกิน 80 ตัวอักษรต่อจุด) ให้โค้ช AI เขียนคำแนะนำ โค้ชเปลี่ยนระดับไม่ได้</li>
    </ol>
    <p><b>ไม่ส่ง:</b> วิดีโอ เสียง ภาพใบหน้า อีเมล หรือชื่อของคุณ</p>
    <p>ระดับ 1–4 ทุกเกณฑ์มาจากเกณฑ์ตัวเลขที่เขียนไว้ในระบบ ไม่มี AI ตัวใดเป็นผู้ตัดสินระดับ</p>
  </> },
  { id: "where", title: "เก็บไว้ที่ไหน และนานเท่าไร", body: <>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[[Server, "หน้าเว็บ", "Vercel"], [Database, "ฐานข้อมูล", "Supabase (สหรัฐอเมริกา)"], [Video, "วิดีโอและการวิเคราะห์", "Modal (สหรัฐอเมริกา)"]].map(([I, k, v]) => { const Icon = I as typeof Server;
        return <div key={k as string} className="rounded-2xl bg-surface p-4"><Icon className="size-5 text-brand" /><p className="mt-2 text-xs">{k as string}</p><b className="text-ink">{v as string}</b></div>; })}
    </div>
    <ul>
      <li><b>วิดีโอ Guest:</b> ลบอัตโนมัติ 7 วัน · <b>วิดีโอสมาชิก:</b> ลบอัตโนมัติ 30 วัน</li>
      <li>ไฟล์อัปโหลดที่ส่งไม่สำเร็จ ลบภายใน 1 วัน ชิ้นไฟล์ระหว่างอัปโหลดลบทันทีที่ต่อกันเสร็จ</li>
      <li>ผลการวิเคราะห์ (ตัวเลขและระดับ) เก็บไว้ในบัญชีเพื่อดูแนวโน้ม จนกว่าคุณขอลบ</li>
    </ul>
  </> },
  { id: "cookie", title: "คุกกี้", body: <div className="flex gap-4">
    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lime text-navy"><Cookie className="size-5" /></span>
    <p>เราใช้คุกกี้ <b>pt_session</b> ตัวเดียวเพื่อจำว่าคุณเข้าสู่ระบบอยู่ (จำเป็นต่อการใช้งาน) ไม่มีคุกกี้วิเคราะห์พฤติกรรม ไม่มีคุกกี้โฆษณา ส่วนการตั้งค่าบางอย่าง เช่น ปิดเสียง หรือวันพรีเซนต์ เก็บไว้ในเบราว์เซอร์ของคุณเองเท่านั้น</p>
  </div> },
  { id: "rights", title: "สิทธิ์ของคุณ (PDPA)", body: <>
    <p>ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 คุณมีสิทธิ์ขอดู ขอสำเนา ขอแก้ไข ขอลบ หรือขอให้หยุดใช้ข้อมูลของคุณ และถอนความยินยอมเมื่อใดก็ได้</p>
    <p>ตอนนี้ยื่นคำขอได้ผ่าน <Link to={PATH.contact}>หน้าแจ้งปัญหา</Link> ทีมจะติดต่อกลับทางอีเมล (ปุ่มลบและดาวน์โหลดข้อมูลในหน้าตั้งค่ากำลังพัฒนา)</p>
  </> },
  { id: "terms", title: "ข้อตกลงการใช้งาน", body: <ul>
    <li>PromptPre's เป็นโครงงานของนักศึกษา ใช้เพื่อ <b>ฝึกซ้อม</b> ไม่ใช่การประเมินผลการเรียนหรือคะแนนสอบ</li>
    <li>ระดับที่แสดงคือ <b>สิ่งที่ระบบวัดได้จากคลิปนั้น</b> อาจคลาดเคลื่อนได้ และไม่ใช่การตัดสินตัวคุณ เกณฑ์ตัวเลขยังเป็นร่างที่รอตรวจความเที่ยงตรง</li>
    <li>อัปโหลดเฉพาะคลิปที่คุณมีสิทธิ์ และคนในคลิปยินยอมแล้ว</li>
    <li>ระบบจำกัดจำนวนรอบที่ส่งได้ต่อวันเพื่อให้ทุกคนใช้ได้ทั่วถึง</li>
  </ul> },
];

export default function Privacy() {
  return <ContentPage eyebrow="ความเป็นส่วนตัวและข้อตกลง" title="ข้อมูลของคุณ ใช้เพื่อการซ้อมของคุณเท่านั้น" updated="23 พฤศจิกายน 2569 (ร่าง รอตรวจโดยอาจารย์ที่ปรึกษา)"
    intro={<p className="flex items-start gap-2"><ShieldCheck className="mt-1 size-5 shrink-0 text-lime" />อ่านจบใน 3 นาที เราเขียนให้ตรงกับที่ระบบทำจริง ไม่มีศัพท์กฎหมายเกินจำเป็น</p>}
    sections={SECTIONS}
    aside={<div className="mt-3 space-y-1.5 border-t border-line px-3 pt-3 text-xs text-muted">
      <p className="flex items-center gap-1.5"><Clock3 className="size-3.5 text-brand" />Guest 7 วัน · สมาชิก 30 วัน</p>
      <p className="flex items-center gap-1.5"><Bot className="size-3.5 text-brand" />AI ได้แค่ข้อความ</p>
      <p className="flex items-center gap-1.5"><Eye className="size-3.5 text-brand" />ไม่วัดอารมณ์หรือการสบตา</p>
    </div>} />;
}
