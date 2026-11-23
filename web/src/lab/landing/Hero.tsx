/* Landing hero: "curtain opens, stage lights come on". Layers, back to front:
   pixel grid (moves all the time, ripples from the mouse) → blue glow → 5 spotlights with dust (visitors can switch
   them) → headline that lights up where the mouse "spotlight" points (the base text is always readable) → stage
   floor with P'Pre, who waves when all 5 lights are on. Phones: the spotlight sweeps by itself. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, PlayCircle } from "lucide-react";
import { Button, Chip } from "@/v2/ui";
import { PPre } from "@/v2/PPre";
import { PixelGrid } from "@/v2/fx/PixelGrid";
import { StageBeams } from "@/v2/fx/StageBeams";
import { SplitChars, Squiggle } from "@/v2/fx/Squiggle";
import { canHover } from "@/v2/fx/useFx";
import { playClick } from "@/v2/prefs";

gsap.registerPlugin(ScrambleTextPlugin);

const STATS: [string, string][] = [["8", "เกณฑ์ที่วัดได้"], ["4", "ทักษะหลัก"], ["0", "คะแนนรวมหรือเกรด"]];

function Headline({ lit }: { lit?: boolean }) {
  return <>
    <SplitChars text="ซ้อมพรีเซนต์ให้" className="block" />
    <span className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:mt-3">
      <span className="relative inline-block -rotate-3 rounded-full bg-lime px-5 pb-1.5 text-navy sm:px-7">
        <SplitChars text="พร้อม" />
        {!lit && <Squiggle shape="arrow" trigger="mount" delay={1.9} className="absolute -left-24 top-1/2 hidden h-16 w-24 -translate-y-1/4 sm:block lg:-left-32 lg:h-20 lg:w-28" />}
      </span>
      <SplitChars text="ก่อนขึ้นเวที" />
    </span>
  </>;
}

export function Hero({ open }: { open: boolean }) {
  const still = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const [lights, setLights] = useState(0);
  const [played, setPlayed] = useState(false); // the opening light-up has finished, visitors may play
  const spot = useRef({ x: 50, y: 50, moved: false });

  // lights come on one by one when the curtain opens
  useEffect(() => {
    if (!open) return;
    if (still) { setLights(5); setPlayed(true); return; }
    const ids = [1, 2, 3, 4, 5].map((n) => window.setTimeout(() => { setLights(n); playClick(n - 1); if (n === 5) setPlayed(true); }, 350 + n * 260));
    return () => ids.forEach(window.clearTimeout);
  }, [open, still]);

  // letters rise in, the stat numbers scramble into place
  useLayoutEffect(() => {
    if (!head.current || still) return;
    const ctx = gsap.context(() => {
      const layers = head.current!.querySelectorAll<HTMLElement>("[data-layer]");
      gsap.set(".hero-fade", { opacity: 0, y: 18 });
      if (!open) { layers.forEach((l) => gsap.set(l.querySelectorAll(".pp-ch"), { opacity: 0, yPercent: 50 })); return; }
      layers.forEach((l) => gsap.to(l.querySelectorAll(".pp-ch"), { opacity: 1, yPercent: 0, duration: 0.7, ease: "back.out(1.6)", stagger: 0.035, delay: 0.25 }));
      gsap.to(".hero-fade", { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, delay: 0.9, ease: "power2.out" });
      gsap.utils.toArray<HTMLElement>(".hero-num").forEach((el, i) => gsap.from(el, { duration: 1, delay: 1.3 + i * 0.15, scrambleText: { text: el.textContent ?? "", chars: "0123456789", speed: 0.6 } }));
    }, root);
    return () => ctx.revert();
  }, [open, still]);

  // the spotlight: follows the mouse; on touch screens (or before the first move) it sweeps across by itself
  useEffect(() => {
    const el = head.current; if (!el) return;
    const set = () => { el.style.setProperty("--mx", `${spot.current.x}%`); el.style.setProperty("--my", `${spot.current.y}%`); };
    set();
    if (still) return;
    gsap.set(spot.current, { x: 15, y: 55 });
    const sweep = gsap.to(spot.current, { x: 85, duration: 3.2, ease: "sine.inOut", repeat: -1, yoyo: true, onUpdate: set });
    if (!canHover()) return () => { sweep.kill(); };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!spot.current.moved) { spot.current.moved = true; sweep.kill(); }
      gsap.to(spot.current, { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, duration: 0.35, ease: "power2.out", onUpdate: set, overwrite: true });
    };
    const sec = root.current!;
    sec.addEventListener("pointermove", move);
    return () => { sweep.kill(); sec.removeEventListener("pointermove", move); };
  }, [still]);

  const toggle = (i: number) => { const n = lights === i + 1 ? i : i + 1; setLights(n); playClick(i); };
  const mask = "radial-gradient(circle min(28vw, 260px) at var(--mx, 50%) var(--my, 50%), #000 15%, transparent 72%)";

  return <section ref={root} className="relative flex min-h-[100svh] flex-col overflow-hidden bg-navy-950 text-white">
    <PixelGrid fadeBottom />
    <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_40%_at_50%_55%,color-mix(in_srgb,var(--color-brand)_38%,transparent),transparent_75%)]" />
    <StageBeams lights={lights} onToggle={played ? toggle : undefined} spread={170} className="z-[1]" lampSize={40} />

    <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-4 pb-48 pt-[clamp(6.5rem,16vh,9rem)] text-center sm:pb-56">
      <motion.p className="mb-6 text-xs font-semibold text-lime/80" initial={{ opacity: 0 }} animate={{ opacity: played ? 1 : 0 }}>ลองกดดวงไฟด้านบน</motion.p>
      <Chip tone="glass" className="hero-fade"><span className="size-1.5 rounded-full bg-lime" />โค้ชซ้อมนำเสนอสำหรับนักศึกษามหาวิทยาลัย</Chip>
      <h1 ref={head} className="relative mt-6 text-[2.5rem] font-bold leading-[1.15] tracking-tight sm:text-6xl lg:text-[5.2rem]">
        <span data-layer className="block text-white/65"><Headline /></span>
        {/* the lit copy, shown only inside the spotlight circle */}
        <span data-layer aria-hidden className="pointer-events-none absolute inset-0 block text-white [text-shadow:0_0_18px_rgb(212_245_60/0.5)]"
          style={{ maskImage: mask, WebkitMaskImage: mask }}><Headline lit /></span>
      </h1>
      <p className="hero-fade mt-6 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg">
        อัดคลิปซ้อมจากเบราว์เซอร์ แล้วรับผล 8 เกณฑ์ ครอบคลุมเนื้อหา การพูด ภาษากาย และเวลา ทุกระดับมีหลักฐานในวิดีโอที่กดดูได้
      </p>
      <div className="hero-fade mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" variant="lime" asChild><a href="#start">เริ่มใช้งานฟรี <ArrowRight /></a></Button>
        <Button size="lg" variant="outlineLight" asChild><a href="#try"><PlayCircle />ดูตัวอย่างผล</a></Button>
      </div>
      <dl className="hero-fade mt-10 grid w-full max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6">
        {STATS.map(([n, l]) => <div key={l}><dt className="hero-num text-3xl font-bold tabular-nums text-lime">{n}</dt><dd className="text-xs text-white/60">{l}</dd></div>)}
      </dl>
    </div>

    {/* stage floor */}
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-44">
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-navy-950 to-transparent" />
      <div className="absolute bottom-8 left-1/2 h-16 w-[min(90vw,780px)] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,var(--color-lime),transparent)] transition-opacity duration-500" style={{ opacity: 0.08 + (lights / 5) * 0.32 }} />
      <div className="absolute bottom-12 left-1/2 h-px w-[min(94vw,980px)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
    </div>
    <div className="absolute bottom-6 left-1/2 z-[3] -translate-x-1/2">
      <PPre pose={lights >= 5 ? "wave" : "idle"} size={120} color="white" label="พี่พรีต์ยืนบนเวที" saySide="right" say={played && lights >= 5 ? "ไฟครบ เวทีพร้อม!" : undefined} sayTone="lime" />
    </div>
  </section>;
}
