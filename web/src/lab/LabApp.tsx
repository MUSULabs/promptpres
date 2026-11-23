/* Dev-only design lab for UX/UI V2 (never shipped: main.tsx mounts it only when import.meta.env.DEV).
   Prototypes run on synthetic fixtures so the owner can judge the direction before real pages change. */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { MotionConfig, motion } from "motion/react";
import { FlaskConical, LayoutGrid, X } from "lucide-react";
import "@/v2/theme.css";
import { Button, cn, Logo } from "@/v2/ui";
import { PPre } from "@/v2/PPre";
import { PageSkeleton, ToastHost } from "@/v2/states";
import { CommandPalette } from "@/v2/CommandPalette";
import { LAB_COMMANDS } from "./commands";

const ResultLab = lazy(() => import("./ResultLab"));
const DashboardLab = lazy(() => import("./DashboardLab"));
const LandingLab = lazy(() => import("./LandingLab"));
const SetupLab = lazy(() => import("./SetupLab"));
const RecordLab = lazy(() => import("./RecordLab"));
const WaitingLab = lazy(() => import("./WaitingLab"));
const LoginLab = lazy(() => import("./LoginLab"));
const SettingsLab = lazy(() => import("./SettingsLab"));
const PrivacyLab = lazy(() => import("./PrivacyLab"));
const AboutLab = lazy(() => import("./AboutLab"));
const HelpLab = lazy(() => import("./HelpLab"));
const HowLab = lazy(() => import("./HowLab"));
const StatusLab = lazy(() => import("./StatusLab"));
const CompareLab = lazy(() => import("./CompareLab"));
const RecapLab = lazy(() => import("./RecapLab"));
const ProgressLab = lazy(() => import("./ProgressLab"));

const GROUPS: { title: string; pages: { to: string; label: string; isNew?: boolean }[] }[] = [
  { title: "หน้าหลัก", pages: [
    { to: "/lab/landing", label: "Landing" }, { to: "/lab/login", label: "เข้าสู่ระบบ", isNew: true },
    { to: "/lab/dashboard", label: "Dashboard + ไฟเวที", isNew: true }, { to: "/lab/dashboard?tour=1", label: "ทัวร์แนะนำ", isNew: true },
  ] },
  { title: "ซ้อมหนึ่งรอบ", pages: [
    { to: "/lab/new", label: "เตรียมซ้อม + วันจริง", isNew: true }, { to: "/lab/record", label: "เวทีจำลอง (อัด)", isNew: true },
    { to: "/lab/waiting", label: "รอผล", isNew: true }, { to: "/lab/result", label: "หน้าผล" },
  ] },
  { title: "ความคืบหน้า (รอบ 2)", pages: [
    { to: "/lab/progress", label: "ความคืบหน้า + ตรา + การ์ดแชร์", isNew: true }, { to: "/lab/recap", label: "สรุปเดือนแบบสไลด์", isNew: true },
    { to: "/lab/compare", label: "ห้องเทียบ 2 รอบ", isNew: true },
  ] },
  { title: "หน้าพื้นฐาน", pages: [
    { to: "/lab/settings", label: "ตั้งค่า", isNew: true }, { to: "/lab/help", label: "ช่วยเหลือ", isNew: true },
    { to: "/lab/how", label: "เราวัดผลอย่างไร", isNew: true }, { to: "/lab/about", label: "เกี่ยวกับ", isNew: true },
    { to: "/lab/privacy", label: "ความเป็นส่วนตัว", isNew: true },
  ] },
  { title: "หน้าสถานะ", pages: [
    { to: "/lab/oops/404", label: "404", isNew: true }, { to: "/lab/oops/offline", label: "ออฟไลน์", isNew: true }, { to: "/lab/oops/maintenance", label: "ปิดปรับปรุง", isNew: true },
  ] },
];

/* main.tsx always loads the V1 global CSS (unlayered, so it beats Tailwind's layers). While the lab is open,
   switch those dev <style> tags off; V2 pages will not need this once V1 CSS is removed in Phase B. */
function useV1CssOff() {
  useLayoutEffect(() => {
    const isV1 = (el: Element) => el instanceof HTMLStyleElement && !!el.dataset.viteDevId && !el.dataset.viteDevId.includes("/src/v2/");
    const off = () => document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => { if (isV1(el)) (el as HTMLStyleElement).disabled = true; });
    off();
    const mo = new MutationObserver(off);
    mo.observe(document.head, { childList: true });
    return () => { mo.disconnect(); document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => { if (isV1(el)) (el as HTMLStyleElement).disabled = false; }); };
  }, []);
}

/** Scroll to the top on page change, or to #id when the link has one. The target may appear late (skeleton,
    lazy page), so keep looking for it for up to 2 seconds. */
function useScrollOnNavigate() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
    let tries = 0, id = 0;
    const look = () => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (++tries < 20) id = window.setTimeout(look, 100);
    };
    id = window.setTimeout(look, 50);
    return () => window.clearTimeout(id);
  }, [pathname, hash]);
}

export default function LabApp() {
  useV1CssOff();
  useScrollOnNavigate();
  const { pathname } = useLocation();
  return <MotionConfig reducedMotion="user"><ToastHost>
    <div className="min-h-dvh overflow-x-clip bg-surface text-ink">
      <LabMenu />
      <CommandPalette commands={LAB_COMMANDS} />
      <Suspense fallback={<PageSkeleton />}>
        {/* opacity only: a transform here would break the fixed sidebar and bottom bar */}
        <motion.div key={pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
        <Routes>
          <Route index element={<LabIndex />} />
          <Route path="landing" element={<LandingLab />} />
          <Route path="login" element={<LoginLab />} />
          <Route path="dashboard" element={<DashboardLab />} />
          <Route path="new" element={<SetupLab />} />
          <Route path="record" element={<RecordLab />} />
          <Route path="waiting" element={<WaitingLab />} />
          <Route path="result" element={<ResultLab />} />
          <Route path="settings" element={<SettingsLab />} />
          <Route path="help" element={<HelpLab />} />
          <Route path="how" element={<HowLab />} />
          <Route path="about" element={<AboutLab />} />
          <Route path="privacy" element={<PrivacyLab />} />
          <Route path="progress" element={<ProgressLab />} />
          <Route path="recap" element={<RecapLab />} />
          <Route path="compare" element={<CompareLab />} />
          <Route path="oops/:kind" element={<StatusLab />} />
          <Route path="*" element={<StatusLab />} />
        </Routes>
        </motion.div>
      </Suspense>
    </div>
  </ToastHost></MotionConfig>;
}

/** Floating "all pages" button: too many pages for the old pill bar. */
function LabMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();
  useEffect(() => setOpen(false), [pathname, search]);
  const here = pathname + search; // links with ?tour=1 are their own item, so compare the query too
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  if (pathname === "/lab" || pathname === "/lab/") return null;
  return <div ref={box} data-lab-menu className="fixed bottom-[84px] left-3 z-[65] lg:bottom-4 lg:left-auto lg:right-4">
    {open && <div className="absolute bottom-12 left-0 max-h-[70vh] w-72 overflow-y-auto rounded-2xl bg-navy p-3 text-white shadow-lift ring-1 ring-white/10 lg:left-auto lg:right-0">
      {GROUPS.map((g) => <div key={g.title} className="mb-2">
        <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-white/50">{g.title}</p>
        {g.pages.map((p) => <Link key={p.to} to={p.to} aria-current={here === p.to ? "page" : undefined} className={cn("flex items-center justify-between rounded-lg px-2 py-1.5 text-sm", here === p.to ? "bg-lime font-semibold text-navy" : "hover:bg-white/10")}>
          {p.label}{p.isNew && <span className="rounded-full bg-white/15 px-1.5 text-[10px] font-semibold">ใหม่</span>}
        </Link>)}
      </div>)}
    </div>}
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-10 items-center gap-2 rounded-full bg-navy/90 px-4 text-xs font-semibold text-white shadow-lift ring-1 ring-white/10 backdrop-blur">
      {open ? <X className="size-4" /> : <FlaskConical className="size-4 text-lime" />}Lab<LayoutGrid className="hidden size-3.5 opacity-60 sm:block" />
    </button>
  </div>;
}

function LabIndex() {
  return <main className="bg-navy-gradient grid-lines min-h-dvh px-4 py-14 text-white sm:px-6">
    <div className="mx-auto max-w-4xl">
      <div className="text-center">
        <Logo dark className="mx-auto h-9" />
        <PPre pose="wave" size={110} color="white" className="mx-auto mt-8" />
        <h1 className="mt-5 text-3xl font-bold">UX/UI V2 Lab</h1>
        <p className="mt-2 text-white/70">ตัวอย่างหน้าตาใหม่ ใช้ข้อมูลจำลองทั้งหมด ไม่ส่งอะไรออกไปจริง</p>
        <Button asChild variant="lime" className="mt-6"><NavLink to="/lab/landing">เริ่มจากหน้าแรก</NavLink></Button>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {GROUPS.map((g) => <section key={g.title} className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-inset ring-white/10">
          <h2 className="font-bold text-lime">{g.title}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {g.pages.map((p) => <NavLink key={p.to} to={p.to} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-sm font-semibold hover:bg-white/20">
              {p.label}{p.isNew && <span className="rounded-full bg-lime px-1.5 text-[10px] text-navy">ใหม่</span>}
            </NavLink>)}
          </div>
        </section>)}
      </div>
    </div>
  </main>;
}
