/* "1 rehearsal = 8 criteria": a result card rises, its radar draws itself, then (scrubbed by scrolling, pinned)
   it breaks into 8 criterion cards that fly to a 4×2 grid, and "no total score" stamps in.
   Phones and "reduce motion": no pin, the cards simply appear one by one. Sample data. */
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { motion, useReducedMotion } from "motion/react";
import type { CriterionCode } from "@/contract";
import { CRITERION_NAME } from "@/presentation";
import { Chip, Logo, SHORT_NAME, SKILL_OF, SkillIcon, cn } from "@/v2/ui";
import { LevelMeter } from "@/v2/viz";
import { RESULT } from "../fixtures";

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);

const ORDER: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];
const SKILL_TH = { content: "เนื้อหา", speech: "การพูด", body: "ภาษากาย", time: "เวลา" } as const;
const level = (c: CriterionCode) => RESULT.criteria.find((x) => x.code === c)?.level ?? null;

function MiniRadar({ className }: { className?: string }) {
  const c = 100, R = 72;
  const pt = (i: number, r: number) => { const a = -Math.PI / 2 + (i * Math.PI) / 4; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
  const shape = ORDER.flatMap((code, i) => { const l = level(code); return l == null ? [] : [pt(i, (l / 4) * R)]; });
  const d = shape.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + " Z";
  return <svg viewBox="0 0 200 200" className={className} aria-hidden>
    {[1, 2, 3, 4].map((l) => <polygon key={l} points={ORDER.map((_, i) => pt(i, (l / 4) * R).join(",")).join(" ")} fill={l === 4 ? "var(--color-brand-50)" : "none"} stroke="var(--color-brand)" strokeOpacity={0.15} />)}
    {ORDER.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--color-brand)" strokeOpacity={0.12} />; })}
    <path className="split-radar-fill" d={d} fill="var(--color-brand)" fillOpacity={0.16} />
    <path className="split-radar" d={d} fill="none" stroke="var(--color-brand)" strokeWidth={3} strokeLinejoin="round" />
    {shape.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill="var(--color-brand)" stroke="white" strokeWidth={1.5} />)}
  </svg>;
}

function CritCard({ code }: { code: CriterionCode }) {
  const l = level(code);
  return <div className="split-card rounded-2xl bg-white p-4 text-ink shadow-lift">
    <div className="flex items-center justify-between gap-2">
      <SkillIcon skill={SKILL_OF[code]} className="size-9 rounded-lg [&_svg]:size-4" />
      <span className="text-[11px] font-semibold text-faint">{SKILL_TH[SKILL_OF[code]]}</span>
    </div>
    <p className="mt-3 text-xs font-bold text-brand">{code}</p>
    <p className="font-bold leading-tight">{SHORT_NAME[code]}</p>
    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted" title={CRITERION_NAME[code]}>{CRITERION_NAME[code]}</p>
    <LevelMeter level={l} size="sm" className="mt-3" />
    <p className="mt-1.5 text-xs font-semibold text-muted">{l == null ? "วิเคราะห์ไม่ได้" : `ระดับ ${l} จาก 4`}</p>
  </div>;
}

export function CardSplit() {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const [pinned] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  const animate = pinned && !still;

  useLayoutEffect(() => {
    if (!animate || !root.current || !stage.current) return;
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>(".split-card");
      // each card starts stacked at the centre of the stage, where the big card is
      const offset = (el: HTMLElement, axis: "x" | "y") => {
        const s = stage.current!.getBoundingClientRect(), r = el.getBoundingClientRect();
        const cur = Number(gsap.getProperty(el, axis)) || 0;
        return axis === "x" ? s.left + s.width / 2 - (r.left + r.width / 2 - cur) : s.top + s.height / 2 - (r.top + r.height / 2 - cur);
      };
      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut" },
        scrollTrigger: { trigger: root.current, start: "top top", end: "+=170%", pin: true, scrub: 0.8, invalidateOnRefresh: true },
      });
      tl.fromTo(".split-main", { y: 140, opacity: 0, rotate: -4 }, { y: 0, opacity: 1, rotate: 0, duration: 0.25 })
        .fromTo(".split-radar", { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.25 }, "<0.08")
        .fromTo(".split-radar-fill", { opacity: 0 }, { opacity: 1, duration: 0.1 }, ">-0.05")
        .to(".split-main", { scale: 0.55, opacity: 0, duration: 0.25 }, "+=0.08")
        .fromTo(cards, {
          x: (_i: number, el: HTMLElement) => offset(el, "x"), y: (_i: number, el: HTMLElement) => offset(el, "y"),
          scale: 0.4, opacity: 0, rotate: (i: number) => (i % 2 ? 1 : -1) * (8 + i * 2),
        }, { x: 0, y: 0, scale: 1, opacity: 1, rotate: 0, duration: 0.35, stagger: 0.025, ease: "back.out(1.2)" }, "<0.05")
        .fromTo(".split-stamp", { scale: 2.2, opacity: 0, rotate: -18 }, { scale: 1, opacity: 1, rotate: -6, duration: 0.12, ease: "back.out(2)" }, ">0.02")
        .fromTo(".split-line2", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.1 }, "<");
    }, root);
    return () => ctx.revert();
  }, [animate]);

  return <section ref={root} className="relative overflow-hidden bg-navy py-16 text-white md:flex md:h-[100svh] md:items-center md:py-0" aria-label="1 รอบซ้อม ได้ผล 8 เกณฑ์">
    <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
    <div className="relative mx-auto w-full max-w-6xl px-4">
      <div className="text-center">
        <p className="font-semibold text-lime">ผลซ้อม 1 รอบ</p>
        <h2 className="mt-1 text-3xl font-bold leading-tight sm:text-5xl">แตกออกเป็น <span className="text-lime">8 เกณฑ์</span> ใน 4 ทักษะ</h2>
        <p className={cn("split-line2 mx-auto mt-3 max-w-lg text-white/70", !animate && "opacity-100")}>แต่ละเกณฑ์มีระดับ 1–4 ของตัวเอง พร้อมหลักฐานในวิดีโอ เห็นชัดว่าควรซ้อมตรงไหนต่อ</p>
      </div>
      <div ref={stage} className="relative mt-10">
        {animate && <div className="split-main pointer-events-none absolute left-1/2 top-1/2 z-10 w-[min(420px,80vw)] -translate-x-1/2 -translate-y-1/2 rounded-panel bg-white p-5 text-ink shadow-[0_40px_80px_-30px_rgb(0_0_0/0.6)]">
          <div className="flex items-center justify-between"><Logo className="h-4" /><Chip tone="line">ข้อมูลตัวอย่าง</Chip></div>
          <MiniRadar className="mx-auto mt-2 w-56" />
          <p className="text-center text-sm font-semibold">ผลซ้อมรอบที่ 9 · 8 เกณฑ์</p>
        </div>}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {ORDER.map((c, i) => animate ? <CritCard key={c} code={c} />
            : <motion.div key={c} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ delay: (i % 4) * 0.06 }}><CritCard code={c} /></motion.div>)}
        </div>
        <span className={cn("split-stamp pointer-events-none absolute -right-2 -top-8 z-20 hidden rotate-[-6deg] rounded-xl border-[3px] border-lime px-4 py-2 text-lg font-bold text-lime md:block", !animate && "md:hidden")}>ไม่มีคะแนนรวม</span>
      </div>
      {!animate && <p className="mt-6 text-center font-bold text-lime">ไม่มีคะแนนรวม ไม่มีเกรด</p>}
    </div>
  </section>;
}
