/* Buttery page scrolling (Lenis) wired to GSAP ScrollTrigger, so pinned and scrubbed parts follow it exactly.
   Off when the device asks for less motion. Only the landing page uses it. */
import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

export function useSmoothScroll() {
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    const lenis = new Lenis({ duration: 1.1, anchors: { offset: -64 }, autoRaf: false });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    document.documentElement.classList.add("lenis-on");
    return () => { gsap.ticker.remove(tick); gsap.ticker.lagSmoothing(500, 33); lenis.destroy(); document.documentElement.classList.remove("lenis-on"); };
  }, [still]);
}
