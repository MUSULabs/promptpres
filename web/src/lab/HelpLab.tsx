/* /lab/help: searchable FAQ, how to film, report a problem (sample form), replay the tour.
   Rules quoted here come from config/thresholds-v0.yaml (unanalyzable blocks) and config/storage-v0.yaml. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronDown, Hand, Map, ScanFace, Search, Send, Sun, Volume2 } from "lucide-react";
import { Button, cn } from "@/v2/ui";
import { ContentPage, type Section } from "@/v2/ContentPage";
import { ErrorPanel, useToast } from "@/v2/states";
import { PPre } from "@/v2/PPre";

const FAQ: { q: string; a: string; tags?: string }[] = [
  { q: "ทำไมบางเกณฑ์ขึ้น \"วิเคราะห์ไม่ได้\"", a: "ระบบมีข้อมูลไม่พอจะให้ระดับอย่างยุติธรรม จึงไม่เดาเป็นระดับ 1 สาเหตุที่พบบ่อย: เห็นมือในกล้องไม่ถึง 70% ของเวลา (N1), เห็นใบหน้าไม่ถึง 70% (N2), พูดจริงไม่ถึง 30 วินาที (S1–S3 และ C2), ไม่ได้ยืนยันหัวข้อ หรือยืนยันไว้น้อยกว่า 3 หัวข้อ (C2), อธิบายหัวข้อชัดเจนไม่ถึง 3 หัวข้อ (C1 ไม่แสดงค่า) หรือไม่ถึง 4 หัวข้อ (C1 ไม่ให้ระดับ) บนการ์ดจะบอกเหตุผลของรอบนั้นเสมอ", tags: "unanalyzable" },
  { q: "รอผลนานเท่าไร", a: "ราว ๆ เท่ากับความยาวคลิป บวกเวลารอคิว หลังส่งวิดีโอครบแล้วปิดเว็บได้ ผลออกแล้วจะแจ้งที่กระดิ่ง" },
  { q: "Guest ต่างจากสมาชิกอย่างไร", a: "Guest ใช้ได้ทันทีโดยไม่ต้องสมัคร แต่วิดีโอเก็บไว้ 7 วัน สมาชิกเก็บ 30 วัน ถ้าสมัครภายหลัง รอบซ้อมของ Guest จะย้ายเข้าบัญชีใหม่ทั้งหมด" },
  { q: "ไฟเวทีนับอย่างไร", a: "ซ้อมอย่างน้อย 1 รอบในสัปดาห์ (จันทร์ถึงอาทิตย์) ไฟติดเพิ่ม 1 ดวง สูงสุด 5 ดวง ถ้าทั้งสัปดาห์ไม่ได้ซ้อม ไฟหรี่ลง 1 ดวง ไม่ดับหมดทันที ไฟเวทีนับจากความสม่ำเสมอเท่านั้น ไม่ดูระดับผล", tags: "streak ไฟ" },
  { q: "ทำไมไม่มีคะแนนรวมหรือเกรด", a: "แต่ละเกณฑ์วัดคนละเรื่อง การรวมเป็นตัวเลขเดียวจะซ่อนว่าควรซ้อมตรงไหน เราจึงแสดง 8 เกณฑ์แยกกัน พร้อมหลักฐานในวิดีโอ" },
  { q: "\"ดีขึ้นจากรอบก่อน\" หมายความว่าทักษะดีขึ้นใช่ไหม", a: "ไม่เสมอไป หมายถึงระดับที่ระบบวัดได้ในรอบนี้สูงกว่ารอบก่อน ซึ่งอาจมาจากหัวข้อ ห้อง หรือกล้องที่ต่างกันด้วย ใช้เป็นสัญญาณให้ดูหลักฐานต่อ ไม่ใช่ข้อพิสูจน์" },
  { q: "ระบบวัดการสบตาหรืออารมณ์ไหม", a: "ไม่วัด N2 ดูแค่ทิศทางศีรษะเทียบกล้องทุก 1 วินาที และระบบไม่อนุมานอารมณ์ ความมั่นใจ หรือความหมายของท่ามือ" },
  { q: "อัปโหลดไฟล์แบบไหนได้บ้าง", a: "วิดีโอ .mp4 .webm .mov ไม่เกิน 512 MB ยาวไม่เกิน 30 นาที และ PDF รายงานหรือสไลด์ไม่เกิน 30 MB (ไม่บังคับ)" },
  { q: "ลบข้อมูลของฉันได้ไหม", a: "ได้ ตอนนี้ส่งคำขอผ่านฟอร์มแจ้งปัญหาด้านล่าง วิดีโอถูกลบอัตโนมัติอยู่แล้วหลัง 7 วัน (Guest) หรือ 30 วัน (สมาชิก)" },
];

const FILM = [
  { Icon: ScanFace, t: "ตั้งกล้องระดับสายตา", d: "ให้เห็นตั้งแต่ศีรษะถึงเอว เห็นใบหน้าอย่างน้อย 70% ของเวลา" },
  { Icon: Hand, t: "ให้มืออยู่ในกรอบ", d: "ถอยห่างกล้องพอให้เห็นมือทั้งสองข้าง อย่างน้อย 70% ของเวลา" },
  { Icon: Sun, t: "แสงอยู่ด้านหน้า", d: "หันหน้าเข้าหาหน้าต่างหรือไฟ อย่ายืนหน้าหน้าต่าง (ย้อนแสง)" },
  { Icon: Volume2, t: "เสียงชัด", d: "ปิดพัดลมหรือแอร์ที่ดัง ไมค์ห่างปากไม่เกิน 1–2 เมตร" },
];

export default function HelpLab() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(0);
  const hits = useMemo(() => { const k = q.trim().toLowerCase(); return FAQ.map((f, i) => ({ ...f, i })).filter((f) => !k || `${f.q} ${f.a} ${f.tags ?? ""}`.toLowerCase().includes(k)); }, [q]);

  const sections: Section[] = useMemo(() => [
    { id: "faq", title: "คำถามที่พบบ่อย", body: <>
      <label className="flex items-center gap-3 rounded-2xl bg-surface px-4 ring-1 ring-inset ring-line focus-within:bg-white focus-within:ring-2 focus-within:ring-brand">
        <Search className="size-5 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์คำถาม เช่น วิเคราะห์ไม่ได้, ไฟเวที, ลบข้อมูล" className="h-12 w-full bg-transparent text-ink outline-none" aria-label="ค้นหาคำถาม" />
      </label>
      {hits.length === 0 ? <div className="flex items-center gap-4 rounded-2xl bg-surface p-5"><PPre pose="think" size={64} /><p>ไม่พบคำถามที่ตรงกับ "{q}" ลองคำอื่น หรือ <a href="#contact">ถามทีมโดยตรง</a></p></div>
        : <ul className="!mt-4 !list-none !space-y-2 !pl-0">{hits.map((f) => { const on = open === f.i;
          return <li key={f.q} className={cn("overflow-hidden rounded-2xl transition-colors", on ? "bg-brand-50" : "bg-surface")}>
            <button type="button" onClick={() => setOpen(on ? null : f.i)} aria-expanded={on} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left font-semibold text-ink">
              {f.q}<ChevronDown className={cn("size-5 shrink-0 text-brand transition-transform", on && "rotate-180")} />
            </button>
            {on && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 pb-5 text-[15px]">{f.a}</motion.p>}
          </li>; })}</ul>}
    </> },
    { id: "film", title: "ถ่ายอย่างไรให้วิเคราะห์ได้ครบ", body: <div className="grid gap-3 sm:grid-cols-2">
      {FILM.map(({ Icon, t, d }) => <div key={t} className="flex gap-3 rounded-2xl bg-surface p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand"><Icon className="size-5" /></span><span><b className="block">{t}</b><span className="text-sm">{d}</span></span></div>)}
    </div> },
    { id: "tour", title: "ดูทัวร์แนะนำอีกครั้ง", body: <div className="flex flex-wrap items-center gap-5">
      <PPre pose="point" size={84} />
      <div className="min-w-0 flex-1"><p>P'Pre จะพาดูหน้าหลักทีละจุด 5 ขั้น ข้ามได้ทุกเมื่อ</p><Button asChild className="mt-3"><Link to="/lab/dashboard?tour=1"><Map />เริ่มทัวร์</Link></Button></div>
    </div> },
    { id: "contact", title: "แจ้งปัญหาหรือติดต่อทีม", body: <ContactForm /> },
  ], [q, hits, open]);

  return <ContentPage eyebrow="ช่วยเหลือ" title="มีคำถาม? เราช่วยได้" intro="ค้นหาคำตอบ ดูวิธีถ่ายคลิป หรือแจ้งปัญหาให้ทีมโดยตรง" sections={sections} />;
}

function ContactForm() {
  const toast = useToast();
  const [topic, setTopic] = useState("bug"), [msg, setMsg] = useState(""), [email, setEmail] = useState(""), [tried, setTried] = useState(false), [sent, setSent] = useState(false);
  const short = msg.trim().length < 10, badMail = email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (sent) return <div className="flex items-center gap-4 rounded-2xl bg-lime-200/60 p-5"><PPre pose="celebrate" size={72} /><div><b className="block text-ink">ส่งเรื่องแล้ว (ตัวอย่าง)</b>ทีมจะติดต่อกลับทางอีเมลที่ให้ไว้ <button type="button" className="font-semibold text-brand hover:underline" onClick={() => { setSent(false); setMsg(""); }}>ส่งเรื่องใหม่</button></div></div>;
  return <form noValidate onSubmit={(e) => { e.preventDefault(); setTried(true); if (short || badMail) return; setSent(true); toast("ส่งเรื่องแล้ว (ตัวอย่าง: ไม่ได้ส่งจริง)"); }} className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {[["bug", "ระบบมีปัญหา"], ["result", "ผลดูแปลก"], ["data", "ขอลบ/ขอดูข้อมูล"], ["idea", "เสนอแนะ"]].map(([k, l]) => <button key={k} type="button" onClick={() => setTopic(k)}
        className={cn("rounded-full px-4 py-2 text-sm font-semibold", topic === k ? "bg-brand text-white" : "bg-surface text-muted hover:text-ink")}>{l}</button>)}
    </div>
    <label className="block text-sm"><span className="font-medium text-ink">เล่าให้ฟังหน่อย</span>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} placeholder="เช่น อัปโหลดถึง 60% แล้วหยุด ใช้ Chrome บนมือถือ ซ้อมวันที่ 23 พ.ย. ประมาณ 15:00" aria-invalid={tried && short}
        className="mt-1.5 w-full rounded-xl bg-surface p-3 text-ink outline-none ring-1 ring-inset ring-line focus:bg-white focus:ring-2 focus:ring-brand" />
      {tried && short && <span className="mt-1 block text-xs font-semibold text-ink">⚠ เขียนอย่างน้อย 10 ตัวอักษร เพื่อให้ทีมเข้าใจปัญหา</span>}
    </label>
    <label className="block text-sm"><span className="font-medium text-ink">อีเมลสำหรับตอบกลับ (ไม่บังคับ)</span>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={badMail} className="mt-1.5 h-11 w-full rounded-xl bg-surface px-3 text-ink outline-none ring-1 ring-inset ring-line focus:bg-white focus:ring-2 focus:ring-brand" />
      {badMail && <span className="mt-1 block text-xs font-semibold text-ink">⚠ รูปแบบอีเมลไม่ถูกต้อง</span>}
    </label>
    {topic === "data" && <ErrorPanel tone="info" what="คำขอลบหรือดูข้อมูล" todo="ใส่อีเมลที่ใช้สมัคร หรือวันเวลาที่ซ้อม (ถ้าเป็น Guest) เพื่อให้ทีมหาข้อมูลของคุณเจอ" />}
    <div className="flex flex-wrap items-center gap-3"><Button type="submit"><Send />ส่งเรื่อง</Button><span className="text-xs text-faint">ตัวอย่าง: ยังไม่ได้ส่งจริง ช่องทางติดต่อของทีมรอเจ้าของโปรเจกต์ใส่</span></div>
  </form>;
}
