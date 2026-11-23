/* /lab/settings: profile, practice goal, presentation day, sound, replay the tour, my data.
   "Download / delete my data" are sample buttons: the real system cannot do this yet (needs an API change later). */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Download, LogOut, Map, Target, Trash2, UserRound, Volume2, Database } from "lucide-react";
import { Button, Chip, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { ConfirmDialog, useToast } from "@/v2/states";
import { PREF, usePref, useDisplayName, writePref } from "@/v2/prefs";
import { countsAsPractice } from "@/v2/streak";
import { LAB_NOW, historyFor, presentDay, thDate, useLabShell } from "./demo";

const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

export default function SettingsLab() {
  const shell = useLabShell();
  const toast = useToast();
  const [saved, setSaved] = useDisplayName();
  const [name, setName] = useState(saved);
  const rounds = historyFor("steady").filter(countsAsPractice).length;
  const [goal, setGoal] = usePref(PREF.weeklyGoal, "1");
  const [sound, setSound] = usePref(PREF.sound, "on");
  const [day, setDay] = usePref(PREF.presentDay, ymd(presentDay()));
  const [ask, setAsk] = useState<"delete" | null>(null);
  const nameErr = !name.trim() ? "ชื่อว่างไม่ได้" : name.length > 80 ? "ยาวได้ไม่เกิน 80 ตัวอักษร" : null;

  return <Shell page="settings" title="ตั้งค่า" subtitle="บัญชี เป้าหมาย และข้อมูลของคุณ" {...shell}>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        <Block Icon={UserRound} title="โปรไฟล์">
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-2xl bg-brand-gradient text-xl font-bold text-white">{[...saved.trim()][0]?.toUpperCase() ?? "G"}</span>
            <div className="min-w-0"><p className="truncate font-semibold">{saved}</p><Chip tone="soft" className="mt-1">Guest (ทดลองใช้)</Chip></div>
          </div>
          <label className="mt-5 block text-sm">
            <span className="font-medium">ชื่อที่แสดง</span>
            <div className="mt-1.5 flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameErr} className={cn("h-11 min-w-0 flex-1 rounded-xl bg-surface px-3 outline-none ring-1 ring-inset focus:ring-2", nameErr ? "ring-navy" : "ring-line focus:ring-brand")} />
              <Button disabled={!!nameErr || name === saved} title={nameErr ?? (name === saved ? "ยังไม่ได้แก้ไข" : undefined)}
                onClick={() => { const old = saved; setSaved(name); toast("บันทึกชื่อแล้ว", () => { setSaved(old); setName(old); }); }}>บันทึก</Button>
            </div>
            {nameErr && <span className="mt-1 block text-xs font-semibold">⚠ {nameErr}</span>}
          </label>
          <div className="mt-5 rounded-2xl bg-lime-200/50 p-4 text-sm">
            <b>สมัครสมาชิกเพื่อเก็บวิดีโอนานขึ้น</b>
            <p className="mt-0.5 text-muted">Guest เก็บวิดีโอ 7 วัน สมาชิก 30 วัน รอบซ้อมที่มีอยู่จะย้ายเข้าบัญชีใหม่ทั้งหมด</p>
            <Button asChild size="sm" className="mt-3"><Link to="/lab/login?tab=register">สมัครสมาชิก</Link></Button>
          </div>
        </Block>

        <Block Icon={Target} title="เป้าการซ้อม">
          <p className="text-sm text-muted">อยากซ้อมกี่รอบต่อสัปดาห์ (ไฟเวทีติดเมื่อซ้อมอย่างน้อย 1 รอบ เป้านี้แสดงบนการ์ดไฟเวทีหน้าหลักให้ติดตามตัวเอง)</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-xl bg-surface p-1">
            {["1", "2", "3"].map((g) => <button key={g} type="button" onClick={() => { setGoal(g); toast(`ตั้งเป้า ${g} รอบต่อสัปดาห์แล้ว`); }}
              className={cn("rounded-lg py-2.5 text-sm font-semibold", goal === g ? "bg-white text-brand shadow-card" : "text-muted hover:text-ink")}>{g} รอบ</button>)}
          </div>
          <label className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <CalendarClock className="size-5 text-brand" /><span className="font-medium">วันพรีเซนต์จริง</span>
            <input type="date" value={day} min={ymd(LAB_NOW)} onChange={(e) => { if (e.target.value) { setDay(e.target.value); toast(`ตั้งวันพรีเซนต์เป็น ${thDate(`${e.target.value}T09:00:00+07:00`, { day: "numeric", month: "long" })} แล้ว`); } }}
              className="h-10 rounded-xl bg-surface px-3 font-semibold outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-brand" />
          </label>
        </Block>

        <Block Icon={Volume2} title="เสียงและการแนะนำ">
          <Toggle label="เสียงคลิกตอนไฟเวทีติด" note="เสียงเบา ๆ ตอนเปิดผล" on={sound === "on"} onChange={(v) => setSound(v ? "on" : "off")} />
          <p className="mt-4 rounded-xl bg-surface p-3 text-xs text-muted">ภาพเคลื่อนไหวจะลดลงเองถ้าเครื่องของคุณเปิด "ลดการเคลื่อนไหว" ไว้ในการตั้งค่าระบบ</p>
          <Button asChild variant="soft" className="mt-4"><Link to="/lab/dashboard?tour=1"><Map />ดูทัวร์แนะนำอีกครั้ง</Link></Button>
        </Block>
      </div>

      <div className="space-y-5 lg:col-span-5">
        <Block Icon={Database} title="ข้อมูลของฉัน">
          <ul className="space-y-2 text-sm">
            {[["รอบซ้อมที่ส่งแล้ว", `${rounds} รอบ`], ["ระยะเวลาเก็บวิดีโอ", "7 วัน (Guest)"], ["ความละเอียดที่เก็บ", "ย่อเหลือ ≤480p"]].map(([k, v]) =>
              <li key={k} className="flex justify-between gap-3 rounded-xl bg-surface px-3 py-2.5"><span className="text-muted">{k}</span><b className="text-right">{v}</b></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">อ่านรายละเอียดว่าเก็บอะไร ส่งอะไรให้ AI ได้ที่ <Link to="/lab/privacy" className="font-semibold text-brand hover:underline">นโยบายความเป็นส่วนตัว</Link></p>
          <div className="mt-5 grid gap-2">
            <Button variant="soft" onClick={() => toast("ตัวอย่าง: ปุ่มนี้จะใช้ได้เมื่อระบบหลังบ้านรองรับ ตอนนี้ขอข้อมูลผ่านหน้าแจ้งปัญหา")}><Download />ดาวน์โหลดข้อมูลของฉัน</Button>
            <Button variant="white" onClick={() => setAsk("delete")} className="ring-1 ring-inset ring-line"><Trash2 />ลบข้อมูลทั้งหมด</Button>
          </div>
          <p className="mt-2 text-[11px] text-faint">สองปุ่มนี้เป็นตัวอย่าง ระบบจริงยังลบหรือดาวน์โหลดเองไม่ได้ ตอนนี้ขอได้ผ่านทีม</p>
        </Block>
        <Button variant="ghost" className="w-full justify-start text-muted" asChild><Link to="/lab/landing" onClick={() => writePref(PREF.signedIn, null)}><LogOut />ออกจากระบบ</Link></Button>
      </div>
    </div>
    <ConfirmDialog open={ask === "delete"} onClose={() => setAsk(null)} requireText="ลบ" confirmLabel="ลบทั้งหมด"
      onConfirm={() => toast("ตัวอย่าง: ระบบจริงจะลบรอบซ้อม วิดีโอ และผลทั้งหมด")} title="ลบข้อมูลทั้งหมด?">
      รอบซ้อม {rounds} รอบ วิดีโอ ผลการวิเคราะห์ และไฟเวทีจะหายทั้งหมด <b className="text-ink">กู้คืนไม่ได้</b>
    </ConfirmDialog>
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
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "bg-brand" : "bg-line")}>
      <span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-[left]", on ? "left-6" : "left-1")} />
    </button>
  </label>;
}
