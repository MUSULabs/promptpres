/* Shared rules for every moving background (pixel grid, stage beams, flowing light, 3D):
   - draw only while the part is on screen and the tab is visible (saves battery),
   - at most 2× pixel density,
   - "reduce motion" in the device settings = one still frame,
   - weaker devices and phones get a lighter version. */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "motion/react";

/** Phones, small screens and machines with few cores or little memory. */
export function isLowPower(): boolean {
  if (typeof window === "undefined") return true;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return window.matchMedia("(max-width: 767px)").matches || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

export const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** True while the element is within `margin` of the screen. */
export function useInView(ref: RefObject<Element | null>, margin = "0px") {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return on;
}

export type Draw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;

/** Runs `draw` on a 2D canvas that fills its parent, at most `fps` times a second (slow backgrounds do not need 60).
    `t` is seconds since start. */
export function useCanvasLoop(canvas: RefObject<HTMLCanvasElement | null>, draw: Draw, fps = 60) {
  const still = useReducedMotion();
  const visible = useInView(canvas, "80px");
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const size = useRef({ w: 0, h: 0 });

  // keep the bitmap the size of the element (capped at 2× density)
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth, h = c.clientHeight;
      size.current = { w, h };
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      const ctx = c.getContext("2d"); ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still && ctx) drawRef.current(ctx, 0, w, h); // still frame after a resize
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(c);
    return () => ro.disconnect();
  }, [canvas, still]);

  useEffect(() => {
    const c = canvas.current; const ctx = c?.getContext("2d"); if (!c || !ctx) return;
    if (still) { drawRef.current(ctx, 0, size.current.w, size.current.h); return; }
    if (!visible) return;
    let raf = 0, last = -1e9; const t0 = performance.now(), gap = 1000 / fps - 4;
    const tick = (now: number) => {
      if (!document.hidden && now - last >= gap) { last = now; drawRef.current(ctx, (now - t0) / 1000, size.current.w, size.current.h); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canvas, visible, still, fps]);
}

/** Pointer position relative to an element, updated on window moves (the canvas itself never takes clicks). */
export function usePointer(ref: RefObject<Element | null>) {
  const p = useRef({ x: -9999, y: -9999, active: false, taps: [] as { x: number; y: number; t: number }[] });
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect(); if (!r) return;
      p.current.x = e.clientX - r.left; p.current.y = e.clientY - r.top;
      p.current.active = p.current.x >= 0 && p.current.y >= 0 && p.current.x <= r.width && p.current.y <= r.height;
    };
    const down = (e: PointerEvent) => {
      move(e);
      if (p.current.active) p.current.taps = [...p.current.taps.slice(-4), { x: p.current.x, y: p.current.y, t: performance.now() }];
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", down); };
  }, [ref]);
  return p;
}

/** Thai-safe split for letter animations: each grapheme keeps its vowel and tone marks. */
export function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg("th", { granularity: "grapheme" }).segment(text), (s) => s.segment) : Array.from(text);
}
