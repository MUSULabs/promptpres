/* Curtain opening, once per visit (about 1.5 s). The page is already loaded behind it; a click or any key skips.
   Not shown when the device asks for less motion. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useReducedMotion } from "motion/react";
import { Logo } from "@/v2/ui";
import { useOverlayFlag } from "@/v2/states";

const KEY = "pp-v2-curtain";
const seen = () => { try { return window.sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = () => { try { window.sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked: may play again */ } };

/** `onOpen` fires when the stage is visible (right away when the curtain is skipped). */
export function CurtainIntro({ onOpen }: { onOpen: () => void }) {
  const still = useReducedMotion();
  const [show, setShow] = useState(() => !still && !seen());
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const opened = useRef(false);
  const open = () => { if (!opened.current) { opened.current = true; onOpen(); } };
  useOverlayFlag(show);

  useEffect(() => { if (!show) open(); }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!show || !root.current) return;
    remember();
    const ctx = gsap.context(() => {
      tl.current = gsap.timeline({ onComplete: () => setShow(false) })
        .from(".cur-logo", { opacity: 0, y: 16, duration: 0.45, ease: "power2.out" })
        .to(".cur-logo", { opacity: 0, scale: 0.92, duration: 0.3, delay: 0.35 })
        .add(open)
        .to(".cur-l", { xPercent: -100, duration: 0.9, ease: "power3.inOut" }, "<0.05")
        .to(".cur-r", { xPercent: 100, duration: 0.9, ease: "power3.inOut" }, "<")
        .to(".cur-top", { yPercent: -100, duration: 0.6, ease: "power2.in" }, "<0.2");
    }, root);
    return () => ctx.revert();
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!show) return;
    const skip = () => { tl.current?.progress(1); };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [show]);

  if (!show) return null;
  // velvet folds: soft vertical stripes in navy and brand blue
  const fabric = "repeating-linear-gradient(90deg, var(--color-navy) 0px, var(--color-navy-800) 28px, var(--color-navy) 56px, var(--color-navy-950) 84px)";
  return <div ref={root} className="fixed inset-0 z-[90] cursor-pointer overflow-hidden" onClick={() => tl.current?.progress(1)} role="presentation">
    <div className="cur-l absolute inset-y-0 left-0 w-1/2 shadow-[20px_0_60px_rgb(0_0_0/0.5)]" style={{ background: fabric }} />
    <div className="cur-r absolute inset-y-0 right-0 w-1/2 shadow-[-20px_0_60px_rgb(0_0_0/0.5)]" style={{ background: fabric }} />
    <div className="cur-top absolute inset-x-0 top-0 h-16 bg-navy-950 shadow-[0_10px_30px_rgb(0_0_0/0.5)]" style={{ backgroundImage: "radial-gradient(circle at 50% 120%, color-mix(in srgb, var(--color-brand) 33%, transparent), transparent 70%)" }} />
    <div className="cur-logo absolute inset-0 grid place-items-center">
      <div className="text-center">
        <Logo dark className="mx-auto h-10 sm:h-12" />
        <p className="mt-4 text-sm text-white/60">กดที่ไหนก็ได้เพื่อข้าม</p>
      </div>
    </div>
  </div>;
}
