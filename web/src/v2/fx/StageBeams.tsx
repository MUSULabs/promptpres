/* Five stage spotlights across the top of a section: lit lamps throw lime beams that sway slowly, and dust
   drifts through them (dust is brighter inside a beam). Lamps can be buttons (the landing hero lets visitors
   switch them) or decoration. Same 5-light idea as the "ไฟเวที" practice streak. */
import { useCallback, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../ui";
import { isLowPower, useCanvasLoop, type Draw } from "./useFx";

export const LAMP_X = [0.14, 0.32, 0.5, 0.68, 0.86]; // share of the width
const TOP = 0.06; // lamp height, share of the height

export function StageBeams({ lights, onToggle, spread = 150, className, lampSize = 44, dust = true }: {
  lights: number; onToggle?: (i: number) => void; spread?: number; className?: string; lampSize?: number; dust?: boolean;
}) {
  const still = useReducedMotion();
  return <div className={cn("pointer-events-none absolute inset-0", className)}>
    <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pp-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4f53c" stopOpacity="0.55" />
          <stop offset="0.55" stopColor="#d4f53c" stopOpacity="0.14" />
          <stop offset="1" stopColor="#d4f53c" stopOpacity="0" />
        </linearGradient>
      </defs>
      {LAMP_X.map((p, i) => { const x = p * 1000, y = TOP * 1000;
        return <motion.g key={i} initial={false} animate={{ opacity: i < lights ? 1 : 0, rotate: still || i >= lights ? 0 : [-(3 + i), 3 + i, -(3 + i)] }}
          transition={{ opacity: { duration: 0.35 }, rotate: { duration: 7 + i * 1.3, repeat: Infinity, ease: "easeInOut" } }}
          style={{ transformOrigin: `${x}px ${y}px`, transformBox: "view-box" }}>
          <polygon points={`${x - 12},${y} ${x + 12},${y} ${x + spread},1000 ${x - spread},1000`} fill="url(#pp-beam)" />
        </motion.g>; })}
    </svg>
    {dust && <Dust lights={lights} spread={spread} />}
    <div className="absolute inset-x-0" style={{ top: `${TOP * 100}%` }}>
      {LAMP_X.map((p, i) => { const on = i < lights;
        const lamp = <span className={cn("block rounded-full transition-[background-color,box-shadow] duration-300", on ? "bg-lime shadow-[0_0_28px_8px_rgb(212_245_60/0.55)]" : "bg-navy-800 ring-2 ring-inset ring-white/25")}
          style={{ width: lampSize * 0.5, height: lampSize * 0.5 }} />;
        const pos = { left: `${p * 100}%`, width: lampSize, height: lampSize, marginLeft: -lampSize / 2, marginTop: -lampSize / 2 };
        return onToggle
          ? <button key={i} type="button" onClick={() => onToggle(i)} aria-pressed={on} aria-label={`ไฟดวงที่ ${i + 1} ${on ? "ติด" : "ดับ"}`}
              className="pointer-events-auto absolute grid place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline-lime" style={pos}>{lamp}</button>
          : <span key={i} aria-hidden className="absolute grid place-items-center" style={pos}>{lamp}</span>;
      })}
    </div>
  </div>;
}

/** Dust specks drifting up; inside a lit beam they glow lime. */
function Dust({ lights, spread }: { lights: number; spread: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const specks = useRef(Array.from({ length: isLowPower() ? 40 : 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, v: 0.006 + Math.random() * 0.018, ph: Math.random() * 6.28 })));
  const lit = useRef(lights); lit.current = lights;
  const draw = useCallback<Draw>((ctx, t, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (const s of specks.current) {
      const y = ((s.y - t * s.v) % 1 + 1) % 1, x = s.x + Math.sin(t * 0.4 + s.ph) * 0.01;
      const px = x * w, py = y * h;
      let inBeam = 0;
      for (let i = 0; i < lit.current; i++) {
        const cx = LAMP_X[i] * w, frac = Math.max(0, (py - TOP * h) / (h * (1 - TOP)));
        const hw = (12 + (spread - 12) * frac) * (w / 1000);
        if (py > TOP * h && Math.abs(px - cx) < hw) inBeam = Math.max(inBeam, 1 - Math.abs(px - cx) / hw);
      }
      ctx.fillStyle = inBeam > 0 ? `rgba(226,249,122,${0.25 + inBeam * 0.6})` : "rgba(255,255,255,0.12)";
      const r = s.r * (inBeam > 0 ? 1.3 : 1); ctx.fillRect(px - r, py - r, r * 2, r * 2); // tiny squares: cheap, and on-brand with the pixel grid
    }
  }, [spread]);
  useCanvasLoop(canvas, draw, 40);
  return <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />;
}
