/* What the Ctrl+K palette can find in the lab: pages, actions, past rounds, the 8 criteria and common questions. */
import { ArrowLeftRight, BookOpenCheck, CalendarClock, ChartNoAxesCombined, CircleHelp, Clapperboard, FileQuestion, History, Info, LayoutDashboard, Map, PlayCircle, Settings, ShieldCheck, Trophy, Video } from "lucide-react";
import { CRITERION_NAME } from "@/presentation";
import { doneRuns } from "@/trend";
import { fmtDuration } from "@/presentation";
import type { CriterionCode } from "@/contract";
import type { Command } from "@/v2/CommandPalette";
import { HISTORY } from "./fixtures";
import { thDate } from "./demo";

const CODES: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];

export const LAB_COMMANDS: Command[] = [
  { id: "a-new", group: "ทำเลย", label: "ซ้อมรอบใหม่", hint: "ตั้งเวลา แล้วอัดหรืออัปโหลด", to: "/lab/new", Icon: Video, keywords: "เริ่ม อัด อัปโหลด record" },
  { id: "a-record", group: "ทำเลย", label: "อัดจากกล้องบนเวทีจำลอง", to: "/lab/record", Icon: Clapperboard, keywords: "กล้อง record" },
  { id: "a-day", group: "ทำเลย", label: "ตั้งวันพรีเซนต์จริง", hint: "นับถอยหลังและแผนซ้อม", to: "/lab/new#day", Icon: CalendarClock, keywords: "วันจริง countdown แผน" },
  { id: "a-recap", group: "ทำเลย", label: "เปิดสรุปเดือนนี้", to: "/lab/recap", Icon: PlayCircle, keywords: "wrapped สรุป เดือน" },
  { id: "a-compare", group: "ทำเลย", label: "เทียบ 2 รอบ", to: "/lab/compare", Icon: ArrowLeftRight, keywords: "compare เทียบ" },
  { id: "a-tour", group: "ทำเลย", label: "ดูทัวร์แนะนำอีกครั้ง", to: "/lab/dashboard?tour=1", Icon: Map, keywords: "tour สอน แนะนำ" },
  { id: "p-home", group: "หน้า", label: "หน้าหลัก", to: "/lab/dashboard", Icon: LayoutDashboard, keywords: "dashboard ไฟเวที" },
  { id: "p-result", group: "หน้า", label: "ผลล่าสุด", to: "/lab/result", Icon: ChartNoAxesCombined, keywords: "result ผล" },
  { id: "p-history", group: "หน้า", label: "ประวัติการซ้อม", to: "/lab/dashboard#history", Icon: History, keywords: "history" },
  { id: "p-progress", group: "หน้า", label: "ความคืบหน้าและตราสะสม", to: "/lab/progress", Icon: Trophy, keywords: "badge ตรา แชร์ share" },
  { id: "p-settings", group: "หน้า", label: "ตั้งค่า", to: "/lab/settings", Icon: Settings, keywords: "settings บัญชี เสียง ลบข้อมูล" },
  { id: "p-help", group: "หน้า", label: "ช่วยเหลือ", to: "/lab/help", Icon: CircleHelp, keywords: "help faq ติดต่อ" },
  { id: "p-how", group: "หน้า", label: "เราวัดผลอย่างไร", to: "/lab/how", Icon: BookOpenCheck, keywords: "เกณฑ์ วิธีวัด" },
  { id: "p-privacy", group: "หน้า", label: "ความเป็นส่วนตัว", to: "/lab/privacy", Icon: ShieldCheck, keywords: "privacy pdpa คุกกี้" },
  { id: "p-about", group: "หน้า", label: "เกี่ยวกับ PromptPre's", to: "/lab/about", Icon: Info, keywords: "about ทีม" },
  ...[...doneRuns(HISTORY)].reverse().map((r) => ({
    id: `r-${r.session_id}`, group: "รอบซ้อม", label: `รอบ ${thDate(r.created_at, { day: "numeric", month: "long", year: "numeric" })}`,
    hint: `คลิป ${fmtDuration(r.duration_s ?? 0)} · ${r.topics_count} หัวข้อ`, to: `/lab/result?id=${r.session_id}`, Icon: Clapperboard, keywords: thDate(r.created_at, { day: "numeric", month: "short" }),
  })),
  ...CODES.map((c) => ({ id: `c-${c}`, group: "เกณฑ์", label: `${c} ${CRITERION_NAME[c]}`, hint: "วัดจากอะไร ระดับหมายความว่าอะไร", to: `/lab/how#${c}`, Icon: BookOpenCheck })),
  { id: "q-na", group: "คำถาม", label: "ทำไมขึ้น \"วิเคราะห์ไม่ได้\"", to: "/lab/help#faq", Icon: FileQuestion, keywords: "unanalyzable" },
  { id: "q-wait", group: "คำถาม", label: "รอผลนานเท่าไร", to: "/lab/help#faq", Icon: FileQuestion },
  { id: "q-stage", group: "คำถาม", label: "ไฟเวทีนับอย่างไร", to: "/lab/help#faq", Icon: FileQuestion, keywords: "streak ไฟ" },
  { id: "q-film", group: "คำถาม", label: "ถ่ายอย่างไรให้วิเคราะห์ได้ครบ", to: "/lab/help#film", Icon: FileQuestion, keywords: "กล้อง แสง เสียง" },
  { id: "q-delete", group: "คำถาม", label: "ขอลบข้อมูลของฉัน", to: "/lab/help#contact", Icon: FileQuestion, keywords: "pdpa ลบ" },
];
