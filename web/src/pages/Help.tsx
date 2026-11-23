/* /help: searchable FAQ, how to film, report a problem (prepares the text; nothing is sent by the site), replay the tour.
   Rules quoted here come from config/thresholds-v0.yaml (unanalyzable blocks) and config/storage-v0.yaml. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronDown, Copy, Hand, Map, ScanFace, Search, Send, Sun, Volume2 } from "lucide-react";
import { Button, cn } from "@/v2/ui";
import { ContentPage, type Section } from "@/v2/ContentPage";
import { ErrorPanel, useToast } from "@/v2/states";
import { PPre } from "@/v2/PPre";
import { PATH } from "@/v2/paths";

/** The team's contact address. Empty until the owner publishes one; the form then falls back to copy text. */
const TEAM_EMAIL = "";
const TOPICS = [["bug", "ระบบมีปัญหา"], ["result", "ผลดูแปลก"], ["data", "ขอลบ/ขอดูข้อมูล"], ["idea", "เสนอแนะ"]] as const;

const FAQ: { q: string; a: string; tags?: string }[] = [
  { q: "ทำไมบางเกณฑ์ขึ้น \"วิเคราะห์ไม่ได้\"", a: "ระบบมีข้อมูลไม่พอจะให้ระดับอย่างยุติธรรม จึงไม่เดาเป็นระดับ 1 สาเหตุที่พบบ่อย: เห็นมือในกล้องน้อยไป (N1), เห็นใบหน้าน้อยไป (N2), ช่วงพูดจริงสั้นไป (S1–S3 และ C2), ไม่ได้ยืนยันหัวข้อหรือยืนยันไว้น้อยไป (C2) และอธิบายหัวข้อชัดเจนน้อยไป (C1) บนการ์ดจะบอกเหตุผลและตัวเลขของรอบนั้นเสมอ", tags: "unanalyzable" },
  { q: "รอผลนานเท่าไร", a: "ราว ๆ เท่ากับความยาวคลิป บวกเวลารอคิว หลังส่งวิดีโอครบแล้วปิดเว็บได้ ผลออกแล้วจะแจ้งที่กระดิ่ง" },
  { q: "Guest ต่างจากสมาชิกอย่างไร", a: "Guest ใช้ได้ทันทีโดยไม่ต้องสมัคร แต่วิดีโอเก็บไว้ 7 วัน สมาชิกเก็บ 30 วัน ถ้าสมัครภายหลัง รอบซ้อมของ Guest จะย้ายเข้าบัญชีใหม่ทั้งหมด" },
  { q: "ไฟเวทีนับอย่างไร", a: "ซ้อมอย่างน้อย 1 รอบในสัปดาห์ (จันทร์ถึงอาทิตย์) ไฟติดเพิ่ม 1 ดวง สูงสุด 5 ดวง ถ้าทั้งสัปดาห์ไม่ได้ซ้อม ไฟหรี่ลง 1 ดวง ไม่ดับหมดทันที ไฟเวทีนับจากความสม่ำเสมอเท่านั้น ไม่ดูระดับผล", tags: "streak ไฟ" },
  { q: "ทำไมไม่มีคะแนนรวมหรือเกรด", a: "แต่ละเกณฑ์วัดคนละเรื่อง การรวมเป็นตัวเลขเดียวจะซ่อนว่าควรซ้อมตรงไหน เราจึงแสดง 8 เกณฑ์แยกกัน พร้อมหลักฐานในวิดีโอ" },
  { q: "\"ดีขึ้นจากรอบก่อน\" หมายความว่าทักษะดีขึ้นใช่ไหม", a: "ไม่เสมอไป หมายถึงระดับที่ระบบวัดได้ในรอบนี้สูงกว่ารอบก่อน ซึ่งอาจมาจากหัวข้อ ห้อง หรือกล้องที่ต่างกันด้วย ใช้เป็นสัญญาณให้ดูหลักฐานต่อ ไม่ใช่ข้อพิสูจน์" },
  { q: "ระบบวัดการสบตาหรืออารมณ์ไหม", a: "ไม่วัด N2 ดูแค่ทิศทางศีรษะเทียบกล้องทุก 1 วินาที และระบบไม่อนุมานอารมณ์ ความมั่นใจ หรือความหมายของท่ามือ" },
  { q: "อัปโหลดไฟล์แบบไหนได้บ้าง", a: "วิดีโอ .mp4 .webm .mov ไม่เกิน 512 MB ยาวไม่เกิน 30 นาที และ PDF รายงานหรือสไลด์ไม่เกิน 30 MB (ไม่บังคับ)" },
  { q: "ลบข้อมูลของฉันได้ไหม", a: "ได้ ตอนนี้ส่งคำขอถึงทีมตามวิธีในหัวข้อแจ้งปัญหาด้านล่าง วิดีโอถูกลบอัตโนมัติอยู่แล้วหลัง 7 วัน (Guest) หรือ 30 วัน (สมาชิก)" },
];

const FILM = [
  { Icon: ScanFace, t: "ตั้งกล้องระดับสายตา", d: "ให้เห็นตั้งแต่ศีรษะถึงเอว และเห็นใบหน้าเกือบตลอดคลิป" },
  { Icon: Hand, t: "ให้มืออยู่ในกรอบ", d: "ถอยห่างกล้องพอให้เห็นมือทั้งสองข้างเกือบตลอดคลิป" },
  { Icon: Sun, t: "แสงอยู่ด้านหน้า", d: "หันหน้าเข้าหาหน้าต่างหรือไฟ อย่ายืนหน้าหน้าต่าง (ย้อนแสง)" },
  { Icon: Volume2, t: "เสียงชัด", d: "ปิดพัดลมหรือแอร์ที่ดัง ไมค์ห่างปากไม่เกิน 1–2 เมตร" },
];

export default function Help() {
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
    { id: "film", title: "ถ่ายอย่างไรให้วิเคราะห์ได้ครบ", body: <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FILM.map(({ Icon, t, d }) => <div key={t} className="flex gap-3 rounded-2xl bg-surface p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand"><Icon className="size-5" /></span><span><b className="block">{t}</b><span className="text-sm">{d}</span></span></div>)}
    </div> },
    { id: "tour", title: "ดูทัวร์แนะนำอีกครั้ง", body: <div className="flex flex-wrap items-center gap-5">
      <PPre pose="point" size={84} />
      <div className="min-w-0 flex-1"><p>P'Pre จะพาดูหน้าหลักทีละจุด 5 ขั้น ข้ามได้ทุกเมื่อ</p><Button asChild className="mt-3"><Link to={PATH.tour}><Map />เริ่มทัวร์</Link></Button></div>
    </div> },
    { id: "contact", title: "แจ้งปัญหาหรือติดต่อทีม", body: <ContactForm /> },
  ], [q, hits, open]);

  return <ContentPage eyebrow="ช่วยเหลือ" title="มีคำถาม? เราช่วยได้" intro="ค้นหาคำตอบ ดูวิธีถ่ายคลิป หรือแจ้งปัญหาให้ทีมโดยตรง" sections={sections} />;
}

/* There is no message endpoint in this release. With TEAM_EMAIL set the form opens the user's mail app with the
   text filled in; without it the user copies the text. Either way the page says plainly that nothing is sent by
   the website itself. */
function ContactForm() {
  const toast = useToast();
  const [topic, setTopic] = useState("bug"), [msg, setMsg] = useState(""), [tried, setTried] = useState(false), [ready, setReady] = useState(false);
  const short = msg.trim().length < 10;
  const label = TOPICS.find(([k]) => k === topic)?.[1] ?? "";
  const text = `เรื่อง: ${label}

${msg.trim()}

(ส่งจากหน้าช่วยเหลือ ${new Date().toLocaleString("th-TH")})`;
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast("คัดลอกข้อความแล้ว"); }
    catch { toast("คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วคัดลอกเอง"); }
  }
  return <form noValidate onSubmit={(e) => {
    e.preventDefault(); setTried(true); if (short) return; setReady(true);
    if (TEAM_EMAIL) window.location.href = `mailto:${TEAM_EMAIL}?subject=${encodeURIComponent(`[PromptPre's] ${label}`)}&body=${encodeURIComponent(text)}`;
  }} className="space-y-4" data-contact-form>
    <ErrorPanel tone="info" what="เว็บยังไม่ส่งเรื่องให้ทีมเองในรุ่นนี้"
      todo={TEAM_EMAIL ? `กดปุ่มด้านล่างแล้วแอปอีเมลจะเปิดพร้อมข้อความ ส่งถึง ${TEAM_EMAIL}` : "เขียนเรื่องแล้วกดเตรียมข้อความ จากนั้นคัดลอกไปส่งให้ทีมผ่านอาจารย์ที่ปรึกษาโครงงาน ช่องทางติดต่อโดยตรงจะเปิดเร็ว ๆ นี้"} />
    <div className="flex flex-wrap gap-2" role="group" aria-label="เรื่องที่จะแจ้ง">
      {TOPICS.map(([k, l]) => <button key={k} type="button" aria-pressed={topic === k} onClick={() => setTopic(k)}
        className={cn("min-h-11 rounded-full px-4 text-sm font-semibold", topic === k ? "bg-brand text-white" : "bg-surface text-muted hover:text-ink")}>{l}</button>)}
    </div>
    <label className="block text-sm"><span className="font-medium text-ink">เล่าให้ฟังหน่อย</span>
      <textarea value={msg} onChange={(e) => { setMsg(e.target.value); setReady(false); }} rows={4} placeholder="เช่น อัปโหลดถึง 60% แล้วหยุด ใช้ Chrome บนมือถือ ซ้อมวันที่ 23 พ.ย. ประมาณ 15:00" aria-invalid={tried && short}
        className="mt-1.5 w-full rounded-xl bg-surface p-3 text-ink outline-none ring-1 ring-inset ring-line focus:bg-white focus:ring-2 focus:ring-brand" />
      {tried && short && <span className="mt-1 block text-xs font-semibold text-ink">⚠ เขียนอย่างน้อย 10 ตัวอักษร เพื่อให้ทีมเข้าใจปัญหา</span>}
    </label>
    {topic === "data" && <ErrorPanel tone="info" what="คำขอลบหรือดูข้อมูล" todo="ใส่อีเมลที่ใช้สมัคร หรือวันเวลาที่ซ้อม (ถ้าเป็น Guest) เพื่อให้ทีมหาข้อมูลของคุณเจอ" />}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit"><Send />{TEAM_EMAIL ? "เปิดอีเมลพร้อมข้อความ" : "เตรียมข้อความ"}</Button>
      {ready && <Button type="button" variant="soft" onClick={copy}><Copy />คัดลอกข้อความ</Button>}
    </div>
    {ready && <div role="status" className="flex items-start gap-3 rounded-2xl bg-lime-200/60 p-4 text-sm"><PPre pose="point" size={56} className="shrink-0" />
      <p><b className="block text-ink">ข้อความพร้อมแล้ว</b>{TEAM_EMAIL ? "ถ้าแอปอีเมลไม่เปิด คัดลอกข้อความแล้วส่งเองได้" : "คัดลอกแล้วส่งให้ทีม เว็บนี้ยังไม่ได้ส่งให้"}</p></div>}
  </form>;
}
