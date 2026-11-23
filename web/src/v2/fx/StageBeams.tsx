/* Five stage spotlights across the top of a section: lit lamps throw lime beams that sway slowly, and dust
   drifts through them (dust is brighter inside a beam). Lamps can be buttons (the landing hero lets visitors
   switch them) or decoration. Same 5-light idea as the "ไฟเวที" practice streak.
   Beams and dust share one canvas. Each beam starts exactly at its lamp's pixel position (worked out from the
   real size every frame), so beams stay attached to the lamps on any section height; only the foot sways. */
import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "../ui";
import { isLowPower, useCanvasLoop, type Draw } from "./useFx";

export const LAMP_X = [0.14, 0.32, 0.5, 0.68, 0.86]; // share of the width
const TOP = 0.06; // lamp height, share of the height

export function StageBeams({ lights, onToggle, spread = 150, className, lampSize = 44, dust = true, strength = 1 }: {
  lights: number; onToggle?: (i: number) => void; spread?: number; className?: string; lampSize?: number; dust?: boolean;
  /** 0–1: how bright the beams are (lower behind text) */ strength?: number;
}) {
  return <div className={cn("pointer-events-none absolute inset-0", className)}>
    <BeamCanvas lights={lights} spread={spread} dust={dust} strength={strength} />
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

function BeamCanvas({ lights, spread, dust, strength }: { lights: number; spread: number; dust: boolean; strength: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = !!useReducedMotion();
  const specks = useRef(dust ? Array.from({ length: isLowPower() ? 40 : 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, v: 0.006 + Math.random() * 0.018, ph: Math.random() * 6.28 })) : []);
  const lit = useRef(lights); lit.current = lights;
  const level = useRef<number[]>(LAMP_X.map((_, i) => (i < lights ? 1 : 0))); // eased on/off per lamp
  const feet = useRef(LAMP_X.map(() => ({ x: 0, half: 0, a: 0 })));

  const draw = useCallback<Draw>((ctx, t, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const ty = TOP * h, len = h - ty;
    const half = Math.max(40, (spread / 1000) * w); // half width of a beam at the floor
    const grad = ctx.createLinearGradient(0, ty, 0, h);
    grad.addColorStop(0, "rgba(212,245,60,0.55)"); grad.addColorStop(0.55, "rgba(212,245,60,0.14)"); grad.addColorStop(1, "rgba(212,245,60,0)");
    ctx.fillStyle = grad;
    for (let i = 0; i < LAMP_X.length; i++) {
      const target = i < lit.current ? 1 : 0;
      level.current[i] = still ? target : level.current[i] + (target - level.current[i]) * 0.12;
      const a = level.current[i] * strength;
      const cx = LAMP_X[i] * w;
      const sway = still ? 0 : Math.sin(t * (0.85 - i * 0.09) + i * 1.7) * Math.tan(((3 + i) * Math.PI) / 180) * len;
      feet.current[i] = { x: cx + sway, half, a };
      if (a < 0.01) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(cx - 7, ty); ctx.lineTo(cx + 7, ty);
      ctx.lineTo(cx + sway + half, h); ctx.lineTo(cx + sway - half, h);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // dust: brighter inside a lit beam (checked against the beam's real, swaying shape)
    for (const s of specks.current) {
      const y = ((s.y - t * s.v) % 1 + 1) % 1, x = s.x + Math.sin(t * 0.4 + s.ph) * 0.01;
      const px = x * w, py = y * h;
      let inBeam = 0;
      if (py > ty) {
        const f = (py - ty) / len;
        for (let i = 0; i < LAMP_X.length; i++) {
          const ft = feet.current[i]; if (ft.a < 0.05) continue;
          const cx = LAMP_X[i] * w + (ft.x - LAMP_X[i] * w) * f, hw = 7 + (ft.half - 7) * f;
          const d = Math.abs(px - cx); if (d < hw) inBeam = Math.max(inBeam, (1 - d / hw) * ft.a);
        }
      }
      ctx.fillStyle = inBeam > 0 ? `rgba(226,249,122,${0.25 + inBeam * 0.6})` : "rgba(255,255,255,0.12)";
      const r = s.r * (inBeam > 0 ? 1.3 : 1); ctx.fillRect(px - r, py - r, r * 2, r * 2); // tiny squares: cheap, and on-brand with the pixel grid
    }
  }, [spread, still, strength]);

  useCanvasLoop(canvas, draw, 40);
  // with reduced motion the loop draws one frame only, so redraw when a lamp is switched
  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext("2d");
    if (still && c && ctx) draw(ctx, 0, c.clientWidth, c.clientHeight);
  }, [still, lights, draw]);
  return <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />;
}
