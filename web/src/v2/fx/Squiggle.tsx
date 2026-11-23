/* Hand-drawn lime marks that draw themselves (GSAP DrawSVG): an arrow, a loose circle around a word,
   a wavy underline (stroke width is in the drawing's own units, so it scales with the mark). "mount" draws after `delay`, "view" when scrolled into sight. Decoration only. */
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";
import { cn } from "../ui";
import { graphemes } from "./useFx";

gsap.registerPlugin(DrawSVGPlugin, ScrollTrigger);

const SHAPES = {
  arrow: { box: "0 0 160 120", d: ["M8 100 C 30 40, 90 20, 132 34", "M112 18 L 134 34 L 114 52"] },
  circle: { box: "0 0 300 120", d: ["M150 10 C 60 6, 8 30, 12 62 C 16 98, 120 114, 210 104 C 280 96, 300 60, 270 34 C 240 10, 160 4, 96 16"] },
  underline: { box: "0 0 300 24", d: ["M4 14 C 40 4, 70 22, 110 12 S 180 4, 220 14 S 280 20, 296 8"] },
} as const;

export function Squiggle({ shape, className, delay = 0, trigger = "view", width = 6 }: {
  shape: keyof typeof SHAPES; className?: string; delay?: number; trigger?: "mount" | "view"; width?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const still = useReducedMotion();
  useLayoutEffect(() => {
    if (still || !ref.current) return;
    const ctx = gsap.context(() => {
      const paths = ref.current!.querySelectorAll("path");
      gsap.fromTo(paths, { drawSVG: "0%" }, {
        drawSVG: "100%", duration: 0.9, ease: "power2.inOut", stagger: 0.35, delay,
        scrollTrigger: trigger === "view" ? { trigger: ref.current, start: "top 85%", once: true } : undefined,
      });
    }, ref);
    return () => ctx.revert();
  }, [still, delay, trigger]);
  const s = SHAPES[shape];
  return <svg ref={ref} aria-hidden viewBox={s.box} fill="none" preserveAspectRatio="none" className={cn("pointer-events-none overflow-visible", className)}>
    {s.d.map((d) => <path key={d} d={d} stroke="var(--color-lime)" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

/** Letters wrapped one by one (Thai-safe) so a timeline can animate `.pp-ch`. Screen readers get the plain text. */
export function SplitChars({ text, className, charClass }: { text: string; className?: string; charClass?: string }) {
  return <span className={className}>
    <span className="sr-only">{text}</span>
    <span aria-hidden>{Array.from(graphemes(text), (g, i) => g === " " ? <span key={i}> </span>
      : <span key={i} className={cn("pp-ch inline-block will-change-transform", charClass)}>{g}</span>)}</span>
  </span>;
}
