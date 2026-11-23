/* What the Ctrl+K palette can find: pages, actions, the user's own rounds, the 8 criteria and common questions. */
import { ArrowLeftRight, BookOpenCheck, CalendarClock, ChartNoAxesCombined, CircleHelp, Clapperboard, FileQuestion, History, Info, LayoutDashboard, LogOut, Map, PlayCircle, Settings, ShieldCheck, Trophy, Video } from "lucide-react";
import { CRITERION_NAME, fmtDuration } from "@/presentation";
import type { CriterionCode, SessionRow } from "@/contract";
import type { Command } from "./CommandPalette";
import { PATH } from "./paths";
import { thDate } from "./time";

const CODES: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];
const STATUS: Record<string, string> = { created: "ยังไม่ส่งวิดีโอ", queued: "รอคิว", processing: "กำลังวิเคราะห์", done: "ผลออกแล้ว", failed: "วิเคราะห์ไม่สำเร็จ" };

export function buildCommands(rows: SessionRow[], signedIn: boolean): Command[] {
  const latest = rows.find((r) => r.status === "done");
  return [
    { id: "a-new", group: "ทำเลย", label: "ซ้อมรอบใหม่", hint: "ตั้งเวลา แล้วอัดหรืออัปโหลด", to: PATH.new, Icon: Video, keywords: "เริ่ม อัด อัปโหลด record" },
    { id: "a-day", group: "ทำเลย", label: "ตั้งวันพรีเซนต์จริง", hint: "นับถอยหลังและแผนซ้อม", to: PATH.newDay, Icon: CalendarClock, keywords: "วันจริง countdown แผน" },
    { id: "a-recap", group: "ทำเลย", label: "เปิดสรุปเดือนนี้", to: PATH.recap, Icon: PlayCircle, keywords: "wrapped สรุป เดือน" },
    { id: "a-compare", group: "ทำเลย", label: "เทียบ 2 รอบ", to: PATH.compare(), Icon: ArrowLeftRight, keywords: "compare เทียบ" },
    { id: "a-tour", group: "ทำเลย", label: "ดูทัวร์แนะนำอีกครั้ง", to: PATH.tour, Icon: Map, keywords: "tour สอน แนะนำ" },
    { id: "p-home", group: "หน้า", label: "หน้าหลัก", to: PATH.home, Icon: LayoutDashboard, keywords: "dashboard ไฟเวที" },
    ...(latest ? [{ id: "p-result", group: "หน้า", label: "ผลล่าสุด", to: PATH.result(latest.session_id), Icon: ChartNoAxesCombined, keywords: "result ผล" }] : []),
    { id: "p-history", group: "หน้า", label: "ประวัติการซ้อม", to: PATH.history, Icon: History, keywords: "history" },
    { id: "p-progress", group: "หน้า", label: "ความคืบหน้าและตราสะสม", to: PATH.progress, Icon: Trophy, keywords: "badge ตรา แชร์ share" },
    { id: "p-settings", group: "หน้า", label: "ตั้งค่า", to: PATH.settings, Icon: Settings, keywords: "settings บัญชี เสียง" },
    { id: "p-help", group: "หน้า", label: "ช่วยเหลือ", to: PATH.help, Icon: CircleHelp, keywords: "help faq ติดต่อ" },
    { id: "p-how", group: "หน้า", label: "เราวัดผลอย่างไร", to: PATH.how, Icon: BookOpenCheck, keywords: "เกณฑ์ วิธีวัด" },
    { id: "p-privacy", group: "หน้า", label: "ความเป็นส่วนตัว", to: PATH.privacy, Icon: ShieldCheck, keywords: "privacy pdpa คุกกี้" },
    { id: "p-about", group: "หน้า", label: "เกี่ยวกับ PromptPre's", to: PATH.about, Icon: Info, keywords: "about ทีม" },
    ...(signedIn ? [{ id: "p-logout", group: "หน้า", label: "ออกจากระบบ", to: PATH.logout, Icon: LogOut, keywords: "logout sign out" }] : []),
    ...rows.slice(0, 30).map((r) => ({
      id: `r-${r.session_id}`, group: "รอบซ้อม", label: `รอบ ${thDate(r.created_at, { day: "numeric", month: "long", year: "numeric" })}`,
      hint: [STATUS[r.status], r.duration_s ? `คลิป ${fmtDuration(r.duration_s)}` : null, r.topics_count ? `${r.topics_count} หัวข้อ` : null].filter(Boolean).join(" · "),
      to: PATH.round(r.session_id, r.status), Icon: Clapperboard, keywords: thDate(r.created_at, { day: "numeric", month: "short" }),
    })),
    ...CODES.map((c) => ({ id: `c-${c}`, group: "เกณฑ์", label: `${c} ${CRITERION_NAME[c]}`, hint: "วัดจากอะไร ระดับหมายความว่าอะไร", to: PATH.criterion(c), Icon: BookOpenCheck })),
    { id: "q-na", group: "คำถาม", label: "ทำไมขึ้น \"วิเคราะห์ไม่ได้\"", to: PATH.faq, Icon: FileQuestion, keywords: "unanalyzable" },
    { id: "q-wait", group: "คำถาม", label: "รอผลนานเท่าไร", to: PATH.faq, Icon: FileQuestion },
    { id: "q-stage", group: "คำถาม", label: "ไฟเวทีนับอย่างไร", to: PATH.faq, Icon: FileQuestion, keywords: "streak ไฟ" },
    { id: "q-film", group: "คำถาม", label: "ถ่ายอย่างไรให้วิเคราะห์ได้ครบ", to: PATH.film, Icon: FileQuestion, keywords: "กล้อง แสง เสียง" },
    { id: "q-delete", group: "คำถาม", label: "ขอลบข้อมูลของฉัน", to: PATH.contact, Icon: FileQuestion, keywords: "pdpa ลบ" },
  ];
}
