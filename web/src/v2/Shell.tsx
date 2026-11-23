/* Signed-in app frame for V2: sidebar on desktop (logo, menu, stage-lights card), bottom bar on phones. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpenCheck, ChartNoAxesCombined, ChevronDown, CircleHelp, Ellipsis, History, LayoutDashboard, LogOut, Plus, Search, Settings, Trophy, UserRoundPlus, Video } from "lucide-react";
import { useAccount } from "@/auth";
import { isMac, openPalette } from "./CommandPalette";
import { Button, cn, Logo } from "./ui";
import { PPre } from "./PPre";
import { Notifications } from "./Notifications";
import { StageLightsMini } from "./StageLights";
import { MAX_LIGHTS, type StageState } from "./streak";
import { useShellData } from "./sessions";
import { PATH } from "./paths";

export type ShellPage = "home" | "new" | "result" | "history" | "progress" | "help" | "how" | "settings";

type NavItem = { key: ShellPage; label: string; short?: string; to: string; Icon: typeof LayoutDashboard };
const MORE: NavItem[] = [
  { key: "help", label: "ช่วยเหลือ", to: PATH.help, Icon: CircleHelp },
  { key: "how", label: "เราวัดผลอย่างไร", to: PATH.how, Icon: BookOpenCheck },
  { key: "settings", label: "ตั้งค่า", to: PATH.settings, Icon: Settings },
];

export function Shell({ page, title, subtitle, actions, children }: {
  page: ShellPage; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const { stage, notes, latestDone } = useShellData();
  // "latest result" opens the newest finished round; with none yet it goes to the history list
  const NAV: NavItem[] = [
    { key: "home", label: "หน้าหลัก", to: PATH.home, Icon: LayoutDashboard },
    { key: "new", label: "ซ้อมรอบใหม่", to: PATH.new, Icon: Video },
    { key: "result", label: "ผลล่าสุด", to: latestDone ? PATH.result(latestDone.session_id) : PATH.history, Icon: ChartNoAxesCombined },
    { key: "history", label: "ประวัติการซ้อม", short: "ประวัติ", to: PATH.history, Icon: History },
    { key: "progress", label: "ความคืบหน้า", to: PATH.progress, Icon: Trophy },
  ];
  return <div className="min-h-dvh bg-surface lg:pl-[248px]">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col overflow-y-auto border-r border-line bg-white px-4 py-6 lg:flex">
      <Link to={PATH.home} className="px-2" aria-label="PromptPre's หน้าหลัก"><Logo className="h-7" /></Link>
      <p className="mt-8 px-3 text-[11px] font-semibold text-faint">เมนู</p>
      <nav aria-label="เมนูหลัก" className="mt-2 space-y-1">{NAV.map((n) => <SideItem key={n.key} item={n} active={page === n.key} />)}</nav>
      <p className="mt-6 px-3 text-[11px] font-semibold text-faint">ช่วยเหลือ</p>
      <nav className="mt-2 space-y-1">{MORE.map((n) => <SideItem key={n.key} item={n} active={page === n.key} tour={n.key === "help" ? "help" : undefined} />)}</nav>
      <div aria-hidden className="min-h-6 flex-1" />
      <StageCard stage={stage} />
    </aside>

    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line/70 bg-surface/85 px-4 backdrop-blur-md sm:px-6 lg:h-20 lg:border-none lg:px-8">
      {/* on a narrow phone the logo gets smaller so the buttons keep their size */}
      <Link to={PATH.home} className="flex min-w-0 shrink lg:hidden" aria-label="PromptPre's หน้าหลัก"><Logo className="h-6 min-w-0 object-contain object-left" /></Link>
      <div className="hidden min-w-0 lg:block">
        <h1 className="truncate text-2xl font-bold">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <button type="button" onClick={openPalette} aria-label="ค้นหาและไปที่ (Ctrl K)" aria-keyshortcuts="Control+K Meta+K"
          className="flex size-10 items-center justify-center gap-2 rounded-full bg-white text-muted shadow-card transition-colors hover:text-brand 2xl:w-56 2xl:justify-start 2xl:px-4">
          <Search className="size-[18px] shrink-0" /><span className="hidden flex-1 text-left text-sm 2xl:block">ค้นหา...</span>
          <kbd className="hidden rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold 2xl:block">{isMac() ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <Notifications notes={notes} />
        <AccountMenu />
      </div>
    </header>

    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1280px] px-4 pb-32 pt-4 outline-none sm:px-6 lg:px-8 lg:pb-16 lg:pt-2">
      <div className="mb-5 lg:hidden">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </main>

    <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[68px] grid-cols-5 items-center border-t border-line bg-white/95 px-2 backdrop-blur-md lg:hidden" aria-label="เมนูหลัก">
      {[NAV[0], NAV[2]].map((n) => <BottomItem key={n.key} item={n} active={page === n.key} />)}
      <Link to={PATH.new} aria-label="ซ้อมรอบใหม่" className="mx-auto -mt-7 grid size-14 place-items-center rounded-full bg-lime text-navy shadow-[0_10px_24px_-8px_rgb(40_35_239/0.45)] ring-4 ring-surface">
        <Plus className="size-6" />
      </Link>
      <BottomItem item={NAV[4]} active={page === "progress"} />
      <MoreMenu page={page} items={[NAV[3], ...MORE]} />
    </nav>
  </div>;
}

function StageCard({ stage }: { stage?: StageState }) {
  const lights = stage?.lights ?? 0;
  const line = !stage || stage.rounds === 0 ? "ซ้อมรอบแรกเพื่อจุดไฟดวงแรก"
    : stage.practicedThisWeek ? (lights >= MAX_LIGHTS ? "ไฟครบ 5 ดวง เวทีสว่างเต็ม" : "สัปดาห์นี้ไฟติดแล้ว")
    : `ซ้อมภายใน ${stage.daysLeft} วันเพื่อรักษาไฟ`;
  return <div className="relative shrink-0 overflow-hidden rounded-2xl bg-navy p-4 pt-5 text-white">
    <div aria-hidden className="absolute -right-10 -top-10 size-32 rounded-full bg-brand/60 blur-2xl" />
    <div className="relative flex items-end justify-between">
      <PPre pose={stage?.atRisk ? "think" : "idle"} size={52} color="white" />
      <StageLightsMini lights={lights} atRisk={stage?.atRisk} dark className="mb-1" />
    </div>
    <p className="relative mt-2 text-xs font-semibold text-lime">ไฟเวที {lights}/{MAX_LIGHTS}{stage && stage.streak > 1 ? ` · ${stage.streak} สัปดาห์ติด` : ""}</p>
    <p className="relative mt-0.5 font-semibold leading-snug">{line}</p>
    <Button asChild variant="lime" size="sm" className="relative mt-3 w-full"><Link to={PATH.new}><Plus />ซ้อมรอบใหม่</Link></Button>
  </div>;
}

function SideItem({ item, active, tour }: { item: NavItem; active: boolean; tour?: string }) {
  return <Link to={item.to} data-tour={tour} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
    active ? "bg-brand text-white shadow-[0_10px_20px_-10px_rgb(40_35_239/0.8)]" : "text-muted hover:bg-brand-50 hover:text-brand")}>
    <item.Icon className="size-[18px]" />{item.label}
  </Link>;
}

function BottomItem({ item, active, tour }: { item: NavItem; active: boolean; tour?: string }) {
  return <Link to={item.to} data-tour={tour} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 text-[10px] font-medium", active ? "text-brand" : "text-faint")}>
    <item.Icon className="size-5" />{item.short ?? item.label}
  </Link>;
}

/** Phone bar: the pages that do not fit in 5 slots (history, help, how we measure, settings). */
function MoreMenu({ page, items }: { page: ShellPage; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const { pathname, hash } = useLocation();
  useEffect(() => setOpen(false), [pathname, hash]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const active = items.some((n) => n.key === page);
  return <div ref={box} className="relative flex justify-center">
    <button ref={btn} type="button" data-tour="help" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"
      className={cn("flex flex-col items-center gap-0.5 text-[10px] font-medium", active || open ? "text-brand" : "text-faint")}>
      <Ellipsis className="size-5" />เพิ่มเติม
    </button>
    {open && <div role="menu" className="absolute bottom-14 right-0 w-56 rounded-2xl bg-white p-2 shadow-lift ring-1 ring-line">
      {items.map((n) => <Link key={n.key} to={n.to} role="menuitem" aria-current={page === n.key ? "page" : undefined}
        className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium", page === n.key ? "bg-brand-50 text-brand" : "text-ink hover:bg-surface")}>
        <n.Icon className="size-[18px]" />{n.label}</Link>)}
    </div>}
  </div>;
}

/** Name chip in the header: opens the account menu (register for a Guest, settings, sign out). */
function AccountMenu() {
  const { user, name, isGuest } = useAccount();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const kind = !user ? "โหมดทดลองในเครื่อง" : isGuest ? "Guest (ทดลองใช้)" : "สมาชิก";
  const item = "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-surface";
  return <div ref={box} className="relative" data-account-menu>
    <button ref={btn} type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`บัญชี ${name}`}
      className="flex min-h-10 items-center gap-2.5 rounded-full bg-white py-1 pl-1 pr-1 shadow-card transition-shadow hover:shadow-lift sm:pr-3">
      <span className="grid size-8 place-items-center rounded-full bg-brand-gradient text-sm font-bold text-white">{[...name.trim()][0]?.toUpperCase() ?? "G"}</span>
      <span className="hidden max-w-32 text-left leading-tight sm:block"><b className="block truncate text-sm">{name}</b><span className="text-[11px] text-muted">{kind}</span></span>
      <ChevronDown className="hidden size-4 text-faint sm:block" />
    </button>
    {open && <div role="menu" className="absolute right-0 top-12 z-40 w-64 rounded-2xl bg-white p-2 shadow-lift ring-1 ring-line">
      <div className="px-3 pb-2 pt-1.5">
        <p className="truncate font-semibold">{name}</p>
        <p className="truncate text-xs text-muted">{user && !isGuest ? user.email : kind}</p>
      </div>
      {isGuest && <Link role="menuitem" to={PATH.register} className={cn(item, "bg-lime/40 text-navy hover:bg-lime/60")}><UserRoundPlus className="size-[18px]" />สมัครสมาชิกเพื่อเก็บประวัติ</Link>}
      <Link role="menuitem" to={PATH.settings} className={item}><Settings className="size-[18px] text-faint" />ตั้งค่า</Link>
      {user && <Link role="menuitem" to={PATH.logout} className={item}><LogOut className="size-[18px] text-faint" />ออกจากระบบ</Link>}
    </div>}
  </div>;
}
