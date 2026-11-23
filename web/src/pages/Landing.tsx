/* Landing page "curtain opens, stage lights on" (owner, 23 Nov 2026). Sections and their moving backgrounds:
   curtain → hero (pixel grid + spotlights + dust) → marquee (speeds up with scrolling) → result card splits into
   8 criteria (pinned) → ซ้อม ดูผล ปรับ → 3 steps (flowing light) → try a sample result (quiet pixel grid) →
   stage lights (beams + dust) → skills → start (3D, loaded late) → footer word that fills with lime.
   Smooth scrolling with Lenis. "Reduce motion" turns all of it into still pictures. */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useAnimationFrame, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, useVelocity } from "motion/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Link } from "react-router-dom";
import { Asterisk, Camera, CheckCircle2, Cookie, FileText, Gauge, Mic, PlayCircle, ShieldCheck, Timer, Video } from "lucide-react";
import { StageLights } from "@/v2/StageLights";
import { AuthCard } from "@/v2/AuthCard";
import { SITE_LINKS } from "@/v2/ContentPage";
import { PREF, readPref, writePref } from "@/v2/prefs";
import type { CriterionCode } from "@/contract";
import { CRITERION_NAME, fmtDuration, SKILLS } from "@/presentation";
import { Button, Chip, Logo, SHORT_NAME, SKILL_OF, SKILL_STYLE, SkillIcon, cn } from "@/v2/ui";
import { PPre } from "@/v2/PPre";
import { LevelBadge, LevelMeter, Radar } from "@/v2/viz";
import { PixelGrid } from "@/v2/fx/PixelGrid";
import { StageBeams } from "@/v2/fx/StageBeams";
import { FlowLight } from "@/v2/fx/FlowLight";
import { Squiggle } from "@/v2/fx/Squiggle";
import { isLowPower, useInView } from "@/v2/fx/useFx";
import { useSmoothScroll } from "@/v2/fx/useSmoothScroll";
import { CurtainIntro } from "./landing/CurtainIntro";
import { Hero } from "./landing/Hero";
import { CardSplit } from "./landing/CardSplit";
import { META, RESULT } from "@/v2/sample";
import { PATH } from "@/v2/paths";

const Stage3D = lazy(() => import("./landing/Stage3D"));
gsap.registerPlugin(ScrollTrigger);

export default function Landing() {
  useSmoothScroll();
  const [open, setOpen] = useState(false);
  return <div id="top" className="bg-navy text-white">
    <CurtainIntro onOpen={() => setOpen(true)} />
    <Header />
    <main id="main-content" tabIndex={-1} className="outline-none">
    <Hero open={open} />
    <Marquee />
    <CardSplit />
    <BigType />
    <Story />
    <TryIt />
    <StageTeaser />
    <div className="relative z-10 rounded-t-[2.5rem] bg-surface text-ink">
      <Skills />
      <Promise3 />
    </div>
    <Start />
    </main>
    <Footer />
    <CookieNotice />
  </div>;
}

/* ---------- Header: hides while scrolling down, comes back on the way up; lime reading progress ---------- */

function Header() {
  const { scrollY, scrollYProgress } = useScroll();
  const [hidden, setHidden] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => { const prev = scrollY.getPrevious() ?? 0; setHidden(y > prev && y > 240); });
  const bar = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  return <motion.header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-navy-950/70 backdrop-blur-md" animate={{ y: hidden ? "-100%" : "0%" }} transition={{ duration: 0.3 }}>
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
      <a href="#top" aria-label="PromptPre's หน้าแรก"><Logo dark className="h-6 sm:h-7" /></a>
      <nav className="hidden gap-7 text-sm font-medium text-white/70 md:flex">
        <a href="#story" className="hover:text-white">วิธีใช้</a><a href="#try" className="hover:text-white">ตัวอย่างผล</a><a href="#skills" className="hover:text-white">8 เกณฑ์</a>
      </nav>
      <div className="flex gap-2">
        <Button size="sm" variant="outlineLight" className="hidden sm:inline-flex" asChild><Link to={PATH.login}>เข้าสู่ระบบ</Link></Button>
        <Button size="sm" variant="lime" asChild><a href="#start">เริ่มใช้งานฟรี</a></Button>
      </div>
    </div>
    <motion.div aria-hidden className="h-0.5 origin-left bg-lime" style={{ scaleX: bar }} />
  </motion.header>;
}

/* ---------- Marquee: the 8 criteria; runs faster (and flips direction) with the scroll ---------- */

function Marquee() {
  const items = (Object.keys(CRITERION_NAME) as CriterionCode[]).map((c) => CRITERION_NAME[c]);
  const still = useReducedMotion();
  const { scrollY } = useScroll();
  const speed = useTransform(useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 }), [-1500, 0, 1500], [-5, 0, 5], { clamp: false });
  const a = useMotionValue(0), b = useMotionValue(-50);
  const dir = useRef(1);
  useAnimationFrame((_, dt) => {
    if (still) return;
    const v = speed.get(); if (v < 0) dir.current = -1; else if (v > 0) dir.current = 1;
    const step = dir.current * (dt / 1000) * (2 + Math.abs(v));
    a.set((((a.get() - step) % 50) - 50) % 50); b.set((((b.get() + step) % 50) - 50) % 50);
  });
  const row = (x: typeof a, cls: string) => <motion.div style={{ x: useTransform(x, (v) => `${v}%`) }} className={cn("flex w-max gap-8 whitespace-nowrap text-lg font-bold", cls)}>
    {[...items, ...items].map((t, i) => <span key={i} className="flex items-center gap-8">{t}<Asterisk className="size-5" /></span>)}
  </motion.div>;
  // The strips repeat each name to loop, so screen readers get the list once from the hidden line instead.
  return <div className="relative z-10 -mt-10 h-36 overflow-hidden sm:h-40">
    <p className="sr-only">8 เกณฑ์: {items.join(" · ")}</p>
    <div aria-hidden className="absolute inset-x-[-5%] top-8 rotate-[2deg] bg-brand py-3">{row(b, "text-white/45")}</div>
    <div aria-hidden className="absolute inset-x-[-5%] top-14 -rotate-[2deg] bg-lime py-3.5 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.6)]">{row(a, "text-navy")}</div>
  </div>;
}

/* ---------- Big outlined words: ซ้อม · ดูผล · ปรับ ---------- */

function BigType() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const a = useTransform(scrollYProgress, [0, 1], ["2%", "-16%"]);
  const b = useTransform(scrollYProgress, [0, 1], ["-16%", "2%"]);
  const rows = [{ x: a, hi: 2 }, { x: b, hi: 1 }, { x: a, hi: 0 }];
  const words = ["ซ้อม", "ดูผล", "ปรับ", "ซ้อม", "ดูผล", "ปรับ"];
  return <section ref={ref} className="overflow-hidden py-14 sm:py-20" aria-label="ซ้อม ดูผล ปรับ แล้วซ้อมอีกครั้ง">
    {rows.map((r, i) => <motion.p key={i} aria-hidden style={{ x: r.x }} className="flex gap-[0.35em] whitespace-nowrap text-[17vw] font-bold leading-[1.15] sm:text-[11vw]">
      {words.map((w, j) => <span key={j} className={cn("relative", j === r.hi || j === r.hi + 3 ? "text-lime" : "text-outline")}>{w}
        {i === 0 && j === 2 && <Squiggle shape="circle" className="absolute -inset-x-[12%] -inset-y-[8%] h-[116%] w-[124%]" width={4} />}
      </span>)}
    </motion.p>)}
    <p className="mx-auto mt-10 max-w-xl px-4 text-center text-white/70">วงจรเดียวที่ใช้ได้ทุกครั้งก่อนสอบโครงงาน: ซ้อม ดูผลพร้อมหลักฐาน ปรับจุดที่ระบบชี้ แล้วซ้อมอีกรอบ</p>
  </section>;
}

/* ---------- Pinned 3-step story (GSAP ScrollTrigger) on flowing light ---------- */

const STEPS = [
  { Icon: FileText, title: "ตั้งหัวข้อและเวลา", text: "อัปโหลดรายงาน PDF ให้ระบบร่างหัวข้อ หรือพิมพ์เอง ตรวจลำดับ แล้วตั้งเวลาเป้าหมาย" },
  { Icon: Camera, title: "อัดคลิปซ้อม", text: "ซ้อมบนเวทีจำลองพร้อมนาฬิกาจับเวลา หรืออัปโหลดคลิปที่มีอยู่แล้ว" },
  { Icon: Gauge, title: "ดูผลพร้อมหลักฐาน", text: "ผล 8 เกณฑ์ แต่ละเกณฑ์มีระดับ 1–4 และเวลาในวิดีโอที่กดไปดูได้ทันที" },
];

function Story() {
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const still = useReducedMotion();
  useLayoutEffect(() => {
    if (still || !root.current || window.matchMedia("(max-width: 767px)").matches) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.create({ trigger: root.current, start: "top top", end: "+=180%", pin: true, scrub: true,
        onUpdate: (self) => setStep(Math.min(2, Math.floor(self.progress * 3))) });
      gsap.from(".story-screen", { scale: 0.9, y: 40, scrollTrigger: { trigger: root.current, start: "top 80%", end: "top top", scrub: true } });
      gsap.from(".story-word", { yPercent: 100, opacity: 0, stagger: 0.08, duration: 0.6, ease: "power3.out", scrollTrigger: { trigger: root.current, start: "top 70%", once: true } });
    }, root);
    return () => ctx.revert();
  }, [still]);
  return <section id="story" ref={root} className="relative overflow-hidden bg-navy">
    <FlowLight />
    <div className="grid-lines absolute inset-0 opacity-70" />
    <div className="absolute inset-0 bg-navy-950/25" />
    <div className="relative mx-auto grid grid-cols-1 min-h-dvh max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2">
      <div>
        <p className="font-semibold text-lime">ใช้งาน 3 ขั้น</p>
        <h2 className="mt-1 text-4xl font-bold leading-tight sm:text-5xl">
          <span className="block overflow-hidden pb-1"><span className="story-word inline-block">จากคลิปซ้อม</span></span>
          <span className="block overflow-hidden pb-1"><span className="story-word inline-block">สู่หลักฐานที่ดูได้จริง</span></span>
        </h2>
        <ol className="mt-8 space-y-3">
          {STEPS.map((s, i) => <li key={s.title}>
            <button type="button" onClick={() => setStep(i)} aria-pressed={step === i} className={cn("flex w-full gap-4 rounded-2xl p-4 text-left transition-all duration-300", step === i ? "bg-white text-ink shadow-lift" : "bg-navy-950/40 text-white/80 backdrop-blur-sm hover:bg-navy-950/55")}>
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", step === i ? "bg-lime text-navy" : "bg-white/10")}><s.Icon className="size-5" /></span>
              <span><b className="text-base">{i + 1}. {s.title}</b><span className={cn("mt-0.5 block text-sm", step === i ? "text-muted" : "text-white/65")}>{s.text}</span></span>
            </button>
          </li>)}
        </ol>
        <div className="mt-6 flex gap-1.5">{STEPS.map((_, i) => <span key={i} className={cn("h-1 rounded-full transition-all", step === i ? "w-10 bg-lime" : "w-4 bg-white/25")} />)}</div>
      </div>
      <div className="story-screen relative mx-auto aspect-[4/3] w-full max-w-[520px] overflow-hidden rounded-panel bg-white text-ink shadow-[0_40px_80px_-30px_rgb(8_7_43/0.7)]">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">{[0, 1, 2].map((c) => <span key={c} className="size-2.5 rounded-full bg-brand-100" />)}<span className="ml-3 text-xs text-faint">promptpres.app</span></div>
        <motion.div key={step} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }} className="h-full p-5">
          {step === 0 && <ScreenTopics />}{step === 1 && <ScreenRecord />}{step === 2 && <ScreenResult />}
        </motion.div>
      </div>
    </div>
  </section>;
}

function ScreenTopics() {
  return <div>
    <div className="flex items-center gap-2 text-sm font-semibold"><Timer className="size-4 text-brand" />เวลาเป้าหมาย <Chip tone="lime">10 นาที</Chip></div>
    <ul className="mt-4 space-y-2">
      {RESULT.topics.map((t, i) => <motion.li key={t.id} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 + i * 0.08 }}
        className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2 text-sm">
        <span className="grid size-6 place-items-center rounded-md bg-brand text-xs font-bold text-white">{t.order}</span>{t.title}<CheckCircle2 className="ml-auto size-4 text-brand" />
      </motion.li>)}
    </ul>
  </div>;
}

function ScreenRecord() {
  return <div className="relative grid h-[85%] place-items-center overflow-hidden rounded-2xl bg-navy">
    <div className="absolute inset-6 rounded-xl border border-dashed border-white/30" />
    <PPre pose="point" size={140} color="white" className="translate-y-6" />
    <span className="absolute left-4 top-3 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold text-white"><motion.span className="size-2 rounded-full bg-lime" animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1, repeat: Infinity }} />กำลังอัด 03:12</span>
    <div className="absolute bottom-3 left-4 flex items-end gap-1">{Array.from({ length: 14 }).map((_, i) => <motion.span key={i} className="w-1 rounded-full bg-lime" animate={{ height: [5, 7 + ((i * 7) % 20), 5] }} transition={{ duration: 0.6 + (i % 4) * 0.15, repeat: Infinity }} />)}</div>
    <div className="absolute right-3 top-3 space-y-1 text-[11px] text-white">{["แสงพอ", "ได้ยินเสียง", "เห็นมือ"].map((x) => <p key={x} className="flex items-center gap-1 rounded-full bg-white/10 px-2"><CheckCircle2 className="size-3 text-lime" />{x}</p>)}</div>
  </div>;
}

function ScreenResult() {
  return <div className="grid h-[85%] grid-cols-[1fr_1.1fr] items-center gap-3">
    <Radar criteria={RESULT.criteria} size={200} showLabels={false} />
    <div className="space-y-2">{RESULT.criteria.slice(2, 7).map((c) => <div key={c.code} className="rounded-lg bg-surface px-2.5 py-1.5">
      <p className="mb-1 flex justify-between text-xs font-semibold">{SHORT_NAME[c.code]}<span className="text-muted">{c.level ?? "?"}</span></p><LevelMeter level={c.level} size="sm" /></div>)}</div>
  </div>;
}

/* ---------- Try it: interactive sample result, on a quiet pixel grid ---------- */

function TryIt() {
  const [pick, setPick] = useState<CriterionCode>("S3");
  const c = RESULT.criteria.find((x) => x.code === pick)!;
  return <section id="try" className="relative overflow-hidden bg-navy-950 py-24">
    <PixelGrid intensity="quiet" fade="edges" className="opacity-80 [mask-image:radial-gradient(ellipse_at_center,transparent_25%,black_75%)]" />
    <div className="relative mx-auto max-w-6xl px-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-semibold text-lime">ลองกดดู</p>
          <h2 className="mt-1 text-4xl font-bold sm:text-5xl">ตัวอย่างผลซ้อม 1 รอบ</h2>
        </div>
        <p className="max-w-sm text-white/60">กดจุดบนกราฟเพื่อดูว่าแต่ละเกณฑ์บอกอะไร (ข้อมูลตัวอย่าง)</p>
      </div>
      <div className="mt-10 grid grid-cols-1 items-center gap-6 md:grid-cols-2">
        <div className="rounded-panel bg-navy/70 p-4 ring-1 ring-white/10 backdrop-blur-sm"><Radar criteria={RESULT.criteria} size={440} active={pick} onPick={setPick} className="mx-auto" dark /></div>
        <motion.div key={pick} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="rounded-panel bg-white p-6 text-ink shadow-lift">
          <div className="flex items-start gap-4">
            <SkillIcon skill={SKILL_OF[pick]} className="size-12" />
            <div className="flex-1"><p className="text-sm text-muted">{SKILLS.find((s) => s.key === c.skill)?.label}</p><h3 className="text-xl font-bold sm:text-2xl">{CRITERION_NAME[pick]}</h3></div>
            <LevelBadge level={c.level} big />
          </div>
          <LevelMeter level={c.level} className="mt-5" />
          <p className="mt-2 font-semibold">{c.level != null ? META[pick]?.interpret?.levels[String(c.level)] : "วิเคราะห์ไม่ได้ในรอบนี้"}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">{META[pick]?.interpret?.explain}</p>
          <div className="mt-5 flex flex-wrap gap-2">{c.evidence.slice(0, 5).map((e, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand tabular-nums"><PlayCircle className="size-3.5" />{fmtDuration(e.start_s)}</span>)}</div>
        </motion.div>
      </div>
    </div>
  </section>;
}

/* ---------- Stage lights teaser: beams + dust across the section; lights come on as it scrolls in ---------- */

function StageTeaser() {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, "-30% 0px");
  const still = useReducedMotion();
  const [lights, setLights] = useState(still ? 3 : 0);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!seen || touched || still) return;
    const ids = [1, 2, 3].map((n) => window.setTimeout(() => setLights((l) => Math.max(l, n)), n * 300));
    return () => ids.forEach(window.clearTimeout);
  }, [seen, touched, still]);
  const set = (n: number) => { setTouched(true); setLights(n); };
  return <section ref={ref} className="relative overflow-hidden bg-navy-950 pb-24 pt-32">
    <StageBeams lights={lights} spread={90} lampSize={30} strength={0.4} className="opacity-80" />
    <div className="relative mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 px-4 md:grid-cols-2">
      <div>
        <Chip tone="lime">ไฟเวที</Chip>
        <h2 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">ซ้อมทุกสัปดาห์<br />เวทีของคุณ<span className="text-lime">ยิ่งสว่าง</span></h2>
        <p className="mt-4 max-w-md text-white/70">ซ้อมอย่างน้อย 1 รอบต่อสัปดาห์ ไฟติดเพิ่มทีละดวง ครบ 5 ดวง P'Pre ออกมายืนกลางเวที หายไปสัปดาห์หนึ่ง ไฟแค่หรี่ลง 1 ดวง ไม่ดับหมด กลับมาซ้อมก็สว่างได้อีก</p>
        <p className="mt-3 text-sm text-white/45">นับจากความสม่ำเสมอในการซ้อม ไม่ใช่ระดับผล</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-sm text-white/60">ลองกด</span>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => set(n)} aria-label={`ไฟ ${n} ดวง`} aria-pressed={n <= lights}
            className={cn("grid size-10 place-items-center rounded-full text-sm font-bold transition-colors", n <= lights ? "bg-lime text-navy" : "bg-white/10 text-white/60 hover:bg-white/20")}>{n}</button>)}
        </div>
      </div>
      <StageLights lights={lights} className="ring-1 ring-inset ring-white/10 shadow-[0_40px_120px_-40px_rgb(212_245_60/0.4)]" />
    </div>
  </section>;
}

/* ---------- 4 skills bento (light band) ---------- */

function Skills() {
  return <section id="skills" className="mx-auto max-w-6xl px-4 pb-16 pt-24">
    <p className="font-semibold text-brand">8 เกณฑ์ ใน 4 ทักษะ</p>
    <h2 className="mt-1 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">ไม่มีคะแนนรวม ไม่มีเกรด<br />
      <span className="relative inline-block text-brand">มีแต่สิ่งที่วัดได้จริง<Squiggle shape="underline" className="absolute -bottom-3 left-0 h-4 w-full" width={6} /></span></h2>
    <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
      {SKILLS.map((s, i) => { const lead = i === 1;
        return <motion.div key={s.key} className={cn("rounded-panel p-6 transition-[box-shadow,transform] duration-300 hover:-translate-y-1", lead ? "bg-brand-gradient text-white shadow-glow md:col-span-2" : "bg-white shadow-card hover:shadow-lift", i === 2 && "md:col-span-2")}
          initial={{ opacity: 0, y: 40, rotate: i % 2 ? 1.5 : -1.5 }} whileInView={{ opacity: 1, y: 0, rotate: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ type: "spring", stiffness: 120, damping: 16, delay: i * 0.08 }}>
          <div className="flex items-center justify-between"><SkillIcon skill={s.key} inverted={lead} className="size-12" /><span className={cn("text-sm font-semibold", lead ? "text-lime" : "text-faint")}>{s.codes.length} เกณฑ์</span></div>
          <h3 className="mt-5 text-2xl font-bold">{s.label}</h3>
          <p className={lead ? "text-white/70" : "text-muted"}>{SKILL_STYLE[s.key].tagline}</p>
          <ul className="mt-4 space-y-1.5">{s.codes.map((c) => <li key={c} className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className={cn("size-4", lead ? "text-lime" : "text-brand")} />{CRITERION_NAME[c]}</li>)}</ul>
        </motion.div>; })}
    </div>
  </section>;
}

function Promise3() {
  const items = [
    { Icon: Gauge, title: "ระดับมาจากเกณฑ์ที่กำหนดไว้", text: "โค้ช AI ช่วยสรุปคำแนะนำ แต่ไม่ได้เป็นผู้ตัดสินระดับ" },
    { Icon: Video, title: "ทุกระดับมีหลักฐาน", text: "กดเวลาเพื่อข้ามไปดูช่วงนั้นในวิดีโอได้ทันที" },
    { Icon: ShieldCheck, title: "วิดีโอลบเองอัตโนมัติ", text: "Guest 7 วัน สมาชิก 30 วัน" },
  ];
  return <section className="mx-auto max-w-6xl px-4 pb-24">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{items.map((x, i) => <motion.div key={x.title} className="flex gap-4 rounded-card bg-white p-5 shadow-card"
      initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lime text-navy"><x.Icon className="size-5" /></span>
      <div><b>{x.title}</b><p className="mt-0.5 text-sm text-muted">{x.text}</p></div></motion.div>)}</div>
  </section>;
}

/* ---------- Start: sign-up card with the 3D stage (three.js loads only near this part) ---------- */

function Start() {
  const ref = useRef<HTMLElement>(null);
  const near = useInView(ref, "100% 0px");
  const still = useReducedMotion();
  const [use3D] = useState(() => !isLowPower());
  const [load, setLoad] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { if (near && use3D && !still) setLoad(true); }, [near, use3D, still]);
  return <section id="start" ref={ref} className="bg-navy-gradient relative overflow-hidden py-24">
    <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
    <div className="relative mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 px-4 md:grid-cols-2">
      <div>
        <h2 className="text-4xl font-bold leading-tight sm:text-6xl">พร้อมซ้อมแล้ว<br /><span className="text-lime">เริ่มได้ใน 1 คลิก</span></h2>
        <p className="mt-4 max-w-md text-white/70">ทดลองใช้ได้ทันทีโดยไม่ต้องสมัคร ถ้าสมัครภายหลัง ประวัติการซ้อมจะย้ายไปอยู่ในบัญชีให้</p>
        <div className="relative mt-6 h-[300px] sm:h-[380px]">
          <StillStage hidden={ready} />
          {load && <Suspense fallback={null}><Stage3D className="absolute inset-0" onReady={() => setReady(true)} /></Suspense>}
        </div>
      </div>
      <motion.div initial={{ y: 30, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
        <AuthCard className="mx-auto" next={PATH.new} />
      </motion.div>
    </div>
  </section>;
}

/** 2D stand-in for the 3D stage: phones, slow machines, "reduce motion", and while three.js loads. */
function StillStage({ hidden }: { hidden?: boolean }) {
  const tiles: { Icon: typeof Mic; cls: string; d: string }[] = [
    { Icon: Mic, cls: "left-[6%] top-[8%]", d: "0s" }, { Icon: Camera, cls: "right-[8%] top-[6%]", d: "1.2s" }, { Icon: Timer, cls: "right-[12%] bottom-[10%]", d: "2.1s" },
  ];
  return <div aria-hidden className={cn("pointer-events-none absolute inset-0 transition-opacity duration-700", hidden && "opacity-0")}>
    <div className="absolute bottom-6 left-1/2 h-10 w-64 -translate-x-1/2 rounded-[50%] bg-lime/25 blur-xl" />
    <PPre pose="wave" color="white" size={160} className="absolute bottom-6 left-1/2 -translate-x-1/2" />
    {tiles.map(({ Icon, cls, d }) => <span key={d} className={cn("absolute grid size-16 animate-float place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow ring-1 ring-white/20 sm:size-20", cls)} style={{ animationDelay: d }}>
      <Icon className="size-7 sm:size-9" /><span className="absolute inset-x-2 top-1.5 h-1/3 rounded-xl bg-white/20 blur-[2px]" /></span>)}
    <span className="absolute bottom-[14%] left-[10%] size-10 animate-float rounded-full border-[10px] border-lime" style={{ animationDelay: "0.6s" }} />
  </div>;
}

/* ---------- Footer: the big outlined word fills with lime as the page ends ---------- */

function Footer() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const fill = useTransform(scrollYProgress, [0.2, 1], ["0%", "100%"]);
  const bg = useTransform(fill, (f) => `linear-gradient(90deg, var(--color-lime) ${f}, transparent ${f})`);
  return <footer ref={ref} className="overflow-hidden bg-navy-950 pb-16 lg:pb-0">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 pt-12 text-sm text-white/50">
      <Logo dark className="h-6" />
      <nav className="flex flex-wrap gap-x-5 gap-y-2">{SITE_LINKS.map((l) => <Link key={l.to} to={l.to} className="hover:text-white">{l.label}</Link>)}</nav>
      <p>โครงงานวิทยาการคอมพิวเตอร์ มหาวิทยาลัยพะเยา</p>
    </div>
    <motion.p aria-hidden style={{ backgroundImage: bg }} className="text-outline -mb-[0.16em] mt-6 select-none whitespace-nowrap bg-clip-text text-center text-[18vw] font-bold leading-none tracking-tight">PromptPre's</motion.p>
  </footer>;
}

/* ---------- Cookie notice (only the login cookie: an info strip, not a consent wall) ---------- */

function CookieNotice() {
  const [seen, setSeen] = useState(() => readPref(PREF.cookieSeen) === "1");
  if (seen) return null;
  return <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 2.4 }} role="region" aria-label="การใช้คุกกี้"
    className="fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl bg-white p-4 text-sm text-ink shadow-lift sm:flex-nowrap">
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lime text-navy"><Cookie className="size-5" /></span>
    <p className="min-w-0 flex-1 text-muted">เราใช้คุกกี้เพียงตัวเดียวเพื่อจำการเข้าสู่ระบบ ไม่มีคุกกี้ติดตามหรือโฆษณา <Link to={`${PATH.privacy}#cookie`} className="font-semibold text-brand hover:underline">อ่านเพิ่ม</Link></p>
    <Button size="sm" onClick={() => { writePref(PREF.cookieSeen, "1"); setSeen(true); }}>เข้าใจแล้ว</Button>
  </motion.div>;
}
