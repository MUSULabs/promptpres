/* Pixel-grid background (the owner's favourite, after the lime/blue pixel poster): square cells that light up
   in slow diagonal waves, a few clusters flip to lime, and the mouse (or a tap) sends a ripple through the grid.
   "hero" is the loud version for the first screen, "quiet" a calm one behind other sections.
   Speed: cells are sorted into a few brightness steps and each step is filled in one call, the per-cell random
   values are worked out once per size, and the grid redraws ~40 times a second (the waves are slow). */
import { useCallback, useRef } from "react";
import { cn } from "../ui";
import { isLowPower, useCanvasLoop, usePointer, type Draw } from "./useFx";

const STEPS = 10; // brightness steps per colour
const COLORS = [[212, 245, 60], [90, 86, 242], [148, 145, 247]] as const; // lime, blue, soft blue

export function PixelGrid({ intensity = "hero", fadeBottom = false, className }: {
  intensity?: "hero" | "quiet"; fadeBottom?: boolean; className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = usePointer(canvas);
  const glow = useRef({ x: -9999, y: -9999 }); // eased pointer, so the light trails the mouse softly
  const hero = intensity === "hero";
  const low = useRef(isLowPower()).current;
  const cache = useRef({ cols: 0, rows: 0, rnd: new Float32Array(0) });
  const buckets = useRef(Array.from({ length: COLORS.length * STEPS }, () => [] as number[]));

  const draw = useCallback<Draw>((ctx, t, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cell = low ? (hero ? 36 : 44) : hero ? 30 : 40, gap = hero ? 3 : 4, s = cell - gap;
    const p = pointer.current, g = glow.current;
    if (p.active) { if (g.x < -5000) { g.x = p.x; g.y = p.y; } g.x += (p.x - g.x) * 0.15; g.y += (p.y - g.y) * 0.15; }
    const now = performance.now();
    const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
    const ox = (w - cols * cell) / 2;

    // per-cell "random" value for the lime clusters (2×2 cells share one), worked out once per grid size
    const c = cache.current;
    if (c.cols !== cols || c.rows !== rows) {
      c.cols = cols; c.rows = rows; c.rnd = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const v = Math.sin(Math.floor(i / 2) * 12.9898 + Math.floor(j / 2) * 78.233) * 43758.5453;
        c.rnd[j * cols + i] = v - Math.floor(v);
      }
    }
    const B = buckets.current; for (const b of B) b.length = 0;
    const taps = p.taps.filter((tap) => now - tap.t < 2000);
    const reach = hero ? 190 : 150, flipAt = hero ? 0.78 : 0.86;
    const fadeFrom = h * 0.5, fadeLen = h * 0.42;
    const phaseB = t * 0.55 + Math.sin(t * 0.2) * 2;

    for (let j = 0; j < rows; j++) {
      const y = j * cell, cy = y + cell / 2;
      const fade = fadeBottom && cy > fadeFrom ? Math.max(0, 1 - (cy - fadeFrom) / fadeLen) : 1;
      if (fade <= 0) break;
      const nearRow = p.active && Math.abs(cy - g.y) < reach;
      for (let i = 0; i < cols; i++) {
        const x = ox + i * cell, cx = x + cell / 2;
        // two slow waves crossing: the base shimmer
        const v = (Math.sin(i * 0.23 + j * 0.17 - t * 0.9) * 0.5 + 0.5) * (Math.sin(i * 0.07 - j * 0.29 + phaseB) * 0.5 + 0.5);
        // mouse light: cells near the (eased) pointer brighten
        let near = 0;
        if (nearRow) { const dx = cx - g.x; if (dx > -reach && dx < reach) near = Math.max(0, 1 - Math.hypot(dx, cy - g.y) / reach); }
        // ripples from taps / clicks: an expanding ring
        let ring = 0;
        for (const tap of taps) {
          const age = (now - tap.t) / 1000, d = Math.hypot(cx - tap.x, cy - tap.y);
          ring = Math.max(ring, Math.max(0, 1 - Math.abs(d - age * 520) / 46) * (1 - age / 2));
        }
        // lime "pixel flips": only the very top of the wave, in blocky clusters
        const flip = v > flipAt && c.rnd[j * cols + i] > 0.55 ? (v - flipAt) * (hero ? 4.5 : 3) : 0;
        const lime = Math.min(1, flip + ring * 0.9) * (hero ? 0.85 : 0.5) * fade;
        const blue = Math.min(1, v * (hero ? 0.22 : 0.12) + near * (hero ? 0.55 : 0.35)) * fade;
        let k: number, a: number;
        if (lime > 0.02) { k = 0; a = lime; } else if (blue > 0.02) { k = near > 0.3 ? 2 : 1; a = blue; } else continue;
        B[k * STEPS + Math.min(STEPS - 1, Math.floor(a * STEPS))].push(x + gap / 2, y + gap / 2);
      }
    }
    // one fill per colour step
    for (let k = 0; k < COLORS.length; k++) {
      const [r, gg, b] = COLORS[k];
      ctx.fillStyle = `rgb(${r},${gg},${b})`;
      for (let st = 0; st < STEPS; st++) {
        const list = B[k * STEPS + st]; if (!list.length) continue;
        ctx.globalAlpha = (st + 0.5) / STEPS;
        ctx.beginPath();
        for (let n = 0; n < list.length; n += 2) ctx.rect(list[n], list[n + 1], s, s);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }, [hero, pointer, low, fadeBottom]);

  useCanvasLoop(canvas, draw, 40);
  return <canvas ref={canvas} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
