/* ไฟเวที: five spotlights over a small stage. Lit lights throw a lime beam onto the floor; when all five are on,
   P'Pre steps into the light. The light that would dim this week (at risk) breathes slowly. */
import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MAX_LIGHTS } from "./streak";
import { PPre } from "./PPre";
import { cn } from "./ui";
import { playClick } from "./prefs";

const XS = [52, 126, 200, 274, 348];

export function StageLights({ lights, atRisk = false, className, sequence = false, from = 0, sound = false, onDone }: {
  lights: number; atRisk?: boolean; className?: string;
  /** Turn the lights on one by one (result moment), starting with `from` already on. */
  sequence?: boolean; from?: number; sound?: boolean; onDone?: () => void;
}) {
  const id = useId().replace(/:/g, "");
  const still = useReducedMotion();
  const start = Math.min(from, lights);
  const [shown, setShown] = useState(sequence && !still ? start : lights);

  useEffect(() => {
    if (!sequence || still || start >= lights) { setShown(lights); onDone?.(); return; }
    setShown(start);
    const timers = Array.from({ length: lights - start }, (_, k) => window.setTimeout(() => {
      const i = start + k;
      setShown(i + 1); if (sound) playClick(i); if (i === lights - 1) onDone?.();
    }, 650 + k * 380));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lights, sequence, still, start]);

  const full = shown >= MAX_LIGHTS;
  return <div className={cn("relative overflow-hidden rounded-2xl bg-navy", className)}>
    <svg viewBox="0 0 400 230" className="block w-full" role="img" aria-label={`ไฟเวทีติด ${lights} จาก ${MAX_LIGHTS} ดวง`}>
      <defs>
        <linearGradient id={`beam-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-lime)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--color-lime)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`pool-${id}`}>
          <stop offset="0" stopColor="var(--color-lime)" stopOpacity="0.5" />
          <stop offset="1" stopColor="var(--color-lime)" stopOpacity="0" />
        </radialGradient>
        <filter id={`glow-${id}`} x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      {/* truss */}
      <rect x="20" y="18" width="360" height="5" rx="2.5" fill="white" opacity="0.12" />
      {/* stage floor */}
      <ellipse cx="200" cy="206" rx="176" ry="20" fill="white" opacity="0.06" />
      <motion.ellipse cx="200" cy="204" rx="150" ry="22" fill={`url(#pool-${id})`} animate={{ opacity: shown / MAX_LIGHTS }} transition={{ duration: 0.5 }} />
      {XS.map((x, i) => {
        const on = i < shown;
        const risky = atRisk && !sequence && i === lights - 1;
        const fx = 200 + (x - 200) * 0.3;
        return <g key={x}>
          <motion.polygon points={`${x - 9},34 ${x + 9},34 ${fx + 40},204 ${fx - 40},204`} fill={`url(#beam-${id})`}
            initial={false} animate={{ opacity: on ? (risky && !still ? [0.85, 0.3, 0.85] : 0.85) : 0 }}
            transition={risky ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.35 }} />
          {on && <circle cx={x} cy="31" r="12" fill="var(--color-lime)" opacity="0.55" filter={`url(#glow-${id})`} />}
          <rect x={x - 3} y="14" width="6" height="10" rx="2" fill="white" opacity="0.25" />
          <motion.circle cx={x} cy="31" r="9" initial={false}
            animate={{ fill: on ? "var(--color-lime)" : "rgba(255,255,255,0)", stroke: on ? "var(--color-lime)" : "rgba(255,255,255,0.3)" }}
            strokeWidth="2" transition={{ duration: 0.3 }} />
        </g>;
      })}
      {/* foreignObject scales with the viewBox, so P'Pre keeps its place at any card width */}
      {full && <foreignObject x="158" y="108" width="84" height="100">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <PPre pose="celebrate" size={84} color="white" label="P'Pre ยืนกลางเวที" />
        </motion.div>
      </foreignObject>}
    </svg>
  </div>;
}

/** Five small lights for the sidebar / headers. */
export function StageLightsMini({ lights, atRisk = false, className, dark }: { lights: number; atRisk?: boolean; className?: string; dark?: boolean }) {
  return <span className={cn("inline-flex items-center gap-1", className)} role="img" aria-label={`ไฟเวที ${lights}/${MAX_LIGHTS}`}>
    {Array.from({ length: MAX_LIGHTS }, (_, i) => {
      const on = i < lights, risky = atRisk && i === lights - 1;
      return <span key={i} className={cn("size-2.5 rounded-full transition-colors",
        on ? "bg-lime shadow-[0_0_8px_rgb(212_245_60/0.8)]" : dark ? "ring-1 ring-inset ring-white/30" : "ring-1 ring-inset ring-brand-200",
        risky && "motion-safe:animate-pulse")} />;
    })}
  </span>;
}
