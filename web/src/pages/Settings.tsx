/* /settings: account (from the API, read-only in this version), practice goal, presentation day, sound, replay
   the tour, my data. Things the system cannot do yet (rename, download or delete my data) are shown switched off
   with the reason and the way to ask the team instead. Goal, day and sound are kept in this browser. */
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Database, Download, Info, LogOut, Map, Target, Trash2, UserRound, Volume2 } from "lucide-react";
import { useAccount } from "@/auth";
import { Button, Chip, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { useToast } from "@/v2/states";
import { PREF, usePref } from "@/v2/prefs";
import { countsAsPractice } from "@/v2/streak";
import { rehearsals, useSessions } from "@/v2/sessions";
import { PATH } from "@/v2/paths";
import { isoDay, thDate } from "@/v2/time";

const NOT_YET = "ยังไม่เปิดในรุ่นนี้ ขอผ่านทีมได้ที่หน้าแจ้งปัญหา";

export default function Settings() {
  const toast = useToast();
  const { user, name, isGuest } = useAccount();
  const { rows } = useSessions();
  const rounds = useMemo(() => rehearsals(rows).filter(countsAsPractice).length, [rows]);
  const [goal, setGoal] = usePref(PREF.weeklyGoal, "1");
  const [sound, setSound] = usePref(PREF.sound, "on");
  const [day, setDay] = usePref(PREF.presentDay, "");
  const kind = !user ? "โหมดทดลองในเครื่อง" : isGuest ? "Guest (ทดลองใช้)" : "สมาชิก";

  return <Shell page="settings" title="ตั้งค่า" subtitle="บัญชี เป้าหมาย และข้อมูลของคุณ">
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        <Block Icon={UserRound} title="บัญชี">
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-2xl bg-brand-gradient text-xl font-bold text-white">{[...name.trim()][0]?.toUpperCase() ?? "G"}</span>
            <div className="min-w-0"><p className="truncate font-semibold">{name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2"><Chip tone="soft">{kind}</Chip>{user && !isGuest && <span className="truncate text-sm text-muted">{user.email}</span>}</div></div>
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface p-3 text-xs text-muted"><Info className="mt-0.5 size-4 shrink-0 text-brand" />แก้ชื่อที่แสดงหรืออีเมล{NOT_YET}</p>
          {isGuest && <div className="mt-4 rounded-2xl bg-lime-200/50 p-4 text-sm">
            <b>สมัครสมาชิกเพื่อเก็บวิดีโอนานขึ้น</b>
            <p className="mt-0.5 text-muted">Guest เก็บวิดีโอ 7 วัน สมาชิก 30 วัน สมัครจากเบราว์เซอร์นี้ รอบซ้อมที่มีอยู่จะย้ายเข้าบัญชีใหม่ทั้งหมด</p>
            <Button asChild size="sm" className="mt-3"><Link to={PATH.register}>สมัครสมาชิก</Link></Button>
          </div>}
        </Block>

        <Block Icon={Target} title="เป้าการซ้อม">
          <p className="text-sm text-muted">อยากซ้อมกี่รอบต่อสัปดาห์ (ไฟเวทีติดเมื่อซ้อมอย่างน้อย 1 รอบ เป้านี้แสดงบนการ์ดไฟเวทีหน้าหลักให้ติดตามตัวเอง)</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-xl bg-surface p-1" role="group" aria-label="เป้าต่อสัปดาห์">
            {["1", "2", "3"].map((g) => <button key={g} type="button" aria-pressed={goal === g} onClick={() => { setGoal(g); toast(`ตั้งเป้า ${g} รอบต่อสัปดาห์แล้ว`); }}
              className={cn("min-h-11 rounded-lg text-sm font-semibold", goal === g ? "bg-white text-brand shadow-card" : "text-muted hover:text-ink")}>{g} รอบ</button>)}
          </div>
          <label className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <CalendarClock className="size-5 text-brand" /><span className="font-medium">วันพรีเซนต์จริง</span>
            <input type="date" value={day} min={isoDay(new Date())} onChange={(e) => { setDay(e.target.value); if (e.target.value) toast(`ตั้งวันพรีเซนต์เป็น ${thDate(`${e.target.value}T09:00:00+07:00`, { day: "numeric", month: "long" })} แล้ว`); }}
              className="h-11 rounded-xl bg-surface px-3 font-semibold outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-brand" />
          </label>
          <p className="mt-2 text-xs text-faint">เป้าและวันพรีเซนต์เก็บไว้ในเบราว์เซอร์นี้เท่านั้น</p>
        </Block>

        <Block Icon={Volume2} title="เสียงและการแนะนำ">
          <Toggle label="เสียงคลิกตอนไฟเวทีติด" note="เสียงเบา ๆ ตอนเปิดผล" on={sound === "on"} onChange={(v) => setSound(v ? "on" : "off")} />
          <p className="mt-4 rounded-xl bg-surface p-3 text-xs text-muted">ภาพเคลื่อนไหวจะลดลงเองถ้าเครื่องของคุณเปิด "ลดการเคลื่อนไหว" ไว้ในการตั้งค่าระบบ ฉากเปิดผลกดข้ามได้เสมอ</p>
          <Button asChild variant="soft" className="mt-4"><Link to={PATH.tour}><Map />ดูทัวร์แนะนำอีกครั้ง</Link></Button>
        </Block>
      </div>

      <div className="space-y-5 lg:col-span-5">
        <Block Icon={Database} title="ข้อมูลของฉัน">
          <ul className="space-y-2 text-sm">
            {[["รอบซ้อมที่ส่งแล้ว", rows ? `${rounds} รอบ` : "…"], ["ระยะเวลาเก็บวิดีโอ", isGuest || !user ? "7 วัน (Guest)" : "30 วัน (สมาชิก)"], ["ความละเอียดที่เก็บ", "ย่อเหลือ ≤480p"]].map(([k, v]) =>
              <li key={k} className="flex justify-between gap-3 rounded-xl bg-surface px-3 py-2.5"><span className="text-muted">{k}</span><b className="text-right">{v}</b></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">อ่านรายละเอียดว่าเก็บอะไร ส่งอะไรให้ AI ได้ที่ <Link to={PATH.privacy} className="font-semibold text-brand hover:underline">นโยบายความเป็นส่วนตัว</Link></p>
          <div className="mt-5 grid gap-2">
            <Button variant="soft" disabled title={NOT_YET} aria-describedby="data-not-yet"><Download />ดาวน์โหลดข้อมูลของฉัน</Button>
            <Button variant="white" disabled title={NOT_YET} aria-describedby="data-not-yet" className="ring-1 ring-inset ring-line"><Trash2 />ลบข้อมูลทั้งหมด</Button>
          </div>
          <p id="data-not-yet" className="mt-2 text-xs text-muted">ดาวน์โหลดและลบข้อมูลเอง{NOT_YET} <Link to={PATH.contact} className="font-semibold text-brand hover:underline">ไปหน้าแจ้งปัญหา</Link></p>
        </Block>
        {user && <Button variant="ghost" className="w-full justify-start text-muted" asChild><Link to={PATH.logout}><LogOut />ออกจากระบบ</Link></Button>}
      </div>
    </div>
  </Shell>;
}

function Block({ Icon, title, children }: { Icon: typeof UserRound; title: string; children: ReactNode }) {
  return <section className="card p-6">
    <h2 className="mb-4 flex items-center gap-2.5 text-lg font-bold"><span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand"><Icon className="size-[18px]" /></span>{title}</h2>
    {children}
  </section>;
}

function Toggle({ label, note, on, onChange }: { label: string; note?: string; on: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-4">
    <span><b className="block text-sm">{label}</b>{note && <span className="text-xs text-muted">{note}</span>}</span>
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "bg-brand" : "bg-line")}>
      <span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-[left]", on ? "left-6" : "left-1")} />
    </button>
  </label>;
}
