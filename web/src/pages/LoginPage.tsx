/* /login: sign in, register or try as Guest, then go on to ?next= (only a path on this site).
   P'Pre stands behind the card: the eyes follow the mouse, or the text being typed; the hands cover the eyes
   while the password field has focus, and slide down to peek when the password is shown. The card tilts a few
   degrees with the mouse and a lime light runs round its edge (no tilt on touch screens or with reduced motion). */
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/auth";
import { Logo } from "@/v2/ui";
import { PPre } from "@/v2/PPre";
import { AuthCard, type AuthLook } from "@/v2/AuthCard";
import { PixelGrid } from "@/v2/fx/PixelGrid";
import { canHover } from "@/v2/fx/useFx";
import { PATH, safeNext } from "@/v2/paths";

const POINTS = ["ผล 8 เกณฑ์ใน 4 ทักษะ ไม่มีคะแนนรวม ไม่มีเกรด", "ทุกระดับมีหลักฐาน กดแล้ววิดีโอเล่นตรงจุดนั้น", "ไฟเวทีติดทุกสัปดาห์ที่คุณซ้อม"];
const TILT = 6; // degrees at the edge of the card

export default function LoginPage() {
  const [p] = useSearchParams();
  const { state } = useAuth();
  const next = safeNext(p.get("next"));
  const tab = p.get("tab") === "register" || p.get("mode") === "register" ? "register" : "login";
  const still = useReducedMotion();
  const [look, setLook] = useState<AuthLook>({ field: null, el: null, show: false });
  const mouse = useMouse();
  const card = useRef<HTMLDivElement>(null);
  const tilt = useTilt(card, !still);

  // A signed-in member has nothing to do here (a Guest stays: registering moves their rounds).
  if (state?.user && !state.user.is_guest) return <Navigate to={next} replace />;

  // eyes: the end of the text in the focused field, else the mouse
  let lookAt: { x: number; y: number } | null = mouse;
  if (look.field && look.field !== "pw" && look.el) {
    const r = look.el.getBoundingClientRect();
    lookAt = { x: r.left + Math.min(r.width, 8 + look.el.value.length * 8.5), y: r.top + r.height / 2 };
  }
  const cover = look.field === "pw";
  const say = cover ? (look.show ? "แอบดูนิดเดียวนะ" : "ไม่แอบดูนะ!") : look.field ? undefined : "สวัสดี! เริ่มแบบ Guest ก่อนก็ได้นะ";

  return <div className="bg-navy-gradient relative min-h-dvh overflow-hidden text-white">
    <PixelGrid intensity="quiet" fade="edges" className="opacity-70 [mask-image:radial-gradient(ellipse_at_70%_45%,transparent_15%,black_70%)]" />
    <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
      <Link to={PATH.home} aria-label="PromptPre's หน้าแรก"><Logo dark className="h-7" /></Link>
      <Link to={PATH.home} className="flex min-h-11 items-center gap-1.5 text-sm text-white/70 hover:text-white"><ArrowLeft className="size-4" />หน้าแรก</Link>
    </header>
    <main id="main-content" tabIndex={-1} className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 pb-24 pt-2 outline-none sm:px-6 md:grid-cols-2 md:gap-12 md:pt-10">
      <div>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl">ยินดีต้อนรับสู่<br /><span className="mt-2 inline-block -rotate-2 rounded-full bg-lime px-5 py-1 text-navy">เวทีซ้อม</span> ของคุณ</h1>
        <ul className="mt-8 hidden space-y-3 sm:block">{POINTS.map((t) => <li key={t} className="flex items-start gap-3 text-white/80"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-lime" />{t}</li>)}</ul>
      </div>
      <div className="mx-auto w-full max-w-md pt-24 [perspective:1100px]">
        <motion.div ref={card} style={{ rotateX: tilt.x, rotateY: tilt.y, transformStyle: "preserve-3d" }} className="relative">
          {/* P'Pre stands behind the card; the card hides the legs */}
          <div className="absolute -top-[104px] right-6 z-0 sm:right-10">
            <PPre pose={cover ? "cover" : "idle"} peek={look.show} lookAt={lookAt} size={128} color="white" say={say} saySide="left" label="P'Pre มาสคอตของ PromptPre's" />
          </div>
          <div className="edge-light relative z-10 rounded-panel">
            <AuthCard hideLogo initialTab={tab} next={next} onLook={setLook} />
          </div>
        </motion.div>
      </div>
    </main>
  </div>;
}

/** Last mouse position on the page (null on touch screens and before the mouse moves). */
function useMouse() {
  const [m, setM] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!canHover()) return;
    let raf = 0, last: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; if (!raf) raf = requestAnimationFrame(() => { raf = 0; setM(last); }); };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return m;
}

/** Spring tilt towards the mouse, ±TILT degrees; flat on touch screens and with reduced motion. */
function useTilt(ref: RefObject<HTMLDivElement | null>, on: boolean) {
  const rx = useMotionValue(0), ry = useMotionValue(0);
  const x = useSpring(rx, { stiffness: 150, damping: 18 }), y = useSpring(ry, { stiffness: 150, damping: 18 });
  useEffect(() => {
    if (!on || !canHover()) return;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const move = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect(); if (!r) return;
      const dx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.9)), dy = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 0.9));
      rx.set(-dy * TILT); ry.set(dx * TILT);
    };
    const reset = () => { rx.set(0); ry.set(0); };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    return () => { window.removeEventListener("pointermove", move); document.documentElement.removeEventListener("pointerleave", reset); };
  }, [on, ref, rx, ry]);
  return { x, y };
}
