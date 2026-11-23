import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";
import { cn } from "./ui";

/* P'Pre, the PromptPre's mascot, rebuilt from the brand SVGs in web/design/mascot/ (same paths, viewBox 408×400)
   but split into parts (body, left arm, right arm, eyes) so each part can move. Eyes, mouth and the gap
   between the feet are cut out with a mask, as in the original files. */

const TORSO = "M146 110 148 58C148 30 165 16 193 16h6c26 0 41 14 41 41l2 46 33-17c21-12 40-7 55 9 16 17 16 40-3 58l-47 46 37 48c17 19 14 43-2 60-14 15-32 16-48 8l-27-13v31c0 21-14 32-42 32-25 0-42-12-42-33v-33l-36 16c-21 11-42 7-56-7-14-14-15-34 0-55l34-52-34-20c-29-17-32-43-15-66 19-25 38-35 63-24Z";
const FEET = "M133 288l55-12-32 99c-3 12-16 13-42 13-19 0-31-2-31-13 0-14 15-23 39-23ZM193 277l46 10 6 63c22-2 37 6 38 22 1 13-11 15-36 15-22 0-38-1-40-12Z";
const LEFT_ARM = "M103 197c-34 3-74 15-81 42-6 23 11 41 37 49l9-27c-10-4-19-9-17-15 3-10 24-16 45-20Z";
const THUMB_ARM = "M277 216c16 8 29 15 42 3-3-9 1-21 10-26 2-10 4-22 10-30 4-6 13-5 17 0 4 6 0 15-3 24 6-1 11 2 14 7 6 3 8 10 6 17-1 7-4 12-9 15-4 10-12 14-22 12-13 14-32 21-52 13Z";
const POINT_ARM = "M268 177c19-1 37-9 51-17 16-15 34-18 56-20 10-1 18 2 18 9 0 8-12 13-29 18 5 8 4 19-2 25-7 8-23 9-32 1-13 3-31 11-52 23Z";
const FEET_GAP = "M182 283q7-7 13-2l15 109h-58Z";
const SMILE = "M180 195c14 2 31 1 46-2 5-1 7 2 6 7-3 21-15 37-30 37-15 0-26-13-30-31-2-8 1-12 8-11Z";

/** Raw shapes for drawing P'Pre outside React (the share-card canvas). */
export const PPRE_SHAPES = { TORSO, FEET, LEFT_ARM, POINT_ARM, FEET_GAP, SMILE, EYES: [[169.5, 157, 16.5, 27], [230, 154, 15.5, 26.5]] as const };

export type Pose = "idle" | "wave" | "celebrate" | "think" | "nod" | "point" | "cover";

const EYES = PPRE_SHAPES.EYES;

const LOOP = { repeat: Infinity, ease: "easeInOut" } as const;

function motionFor(pose: Pose, still: boolean) {
  const none = { figure: {}, left: {}, right: {}, body: {} } as Record<"figure" | "left" | "right" | "body", TargetAndTransition>;
  if (still) return none;
  switch (pose) {
    case "wave": return { ...none, figure: { y: [0, -4, 0], transition: { duration: 3, ...LOOP } }, right: { rotate: [0, -16, 4, -16, 0], transition: { duration: 1.8, ...LOOP, repeatDelay: 1.2 } } };
    case "celebrate": return {
      figure: { y: [0, -18, 0, -8, 0], rotate: [0, -2, 0, 2, 0], transition: { duration: 1.6, ...LOOP } },
      left: { rotate: [70, 86, 70], transition: { duration: 0.8, ...LOOP } },
      right: { rotate: [-38, -52, -38], transition: { duration: 0.8, ...LOOP } }, body: {},
    };
    case "think": return { ...none, body: { rotate: [-2, 2, -2], transition: { duration: 4, ...LOOP } }, figure: { y: [0, -3, 0], transition: { duration: 4, ...LOOP } } };
    case "nod": return { ...none, body: { rotate: [0, 3, 0, 3, 0], transition: { duration: 1.8, ...LOOP, repeatDelay: 1.4 } } };
    case "point": return { ...none, right: { x: [0, 6, 0], transition: { duration: 1.6, ...LOOP } }, figure: { y: [0, -3, 0], transition: { duration: 3.6, ...LOOP } } };
    case "cover": return none;
    default: return { ...none, figure: { y: [0, -5, 0], transition: { duration: 4.2, ...LOOP } } };
  }
}

export function PPre({ pose = "idle", size = 160, color = "var(--color-brand)", say, sayTone = "white", saySide = "right", className, label, lookAt, peek }: {
  pose?: Pose; size?: number; color?: string; say?: ReactNode; sayTone?: "white" | "lime"; saySide?: "right" | "left" | "top"; className?: string; label?: string;
  /** a point on screen (client px) the eyes turn towards, e.g. the mouse or the field being typed in */
  lookAt?: { x: number; y: number } | null;
  /** with pose "cover": hands slide down a little so P'Pre peeks (the password is shown) */
  peek?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const still = useReducedMotion() ?? false;
  const m = motionFor(pose, still);
  const blink = useBlink(still);
  const rightArm = pose === "idle" || pose === "nod" || pose === "think" ? THUMB_ARM : POINT_ARM;
  const pivot = (x: number, y: number) => ({ transformBox: "view-box" as const, transformOrigin: `${x}px ${y}px` });
  const eyeScale = blink ? 0.12 : 1;
  const eyeT: Transition = { duration: 0.09 };
  const lookUp = pose === "think";
  const cover = pose === "cover";
  const box = useRef<HTMLDivElement>(null);
  const pupil = usePupil(box, lookAt, size);

  return <div ref={box} className={cn("relative inline-block", className)} style={{ width: size, height: size * 400 / 408 }}>
    <motion.svg viewBox="0 0 408 400" width={size} height={size * 400 / 408} role={label ? "img" : undefined}
      aria-label={label} aria-hidden={label ? undefined : true} className="overflow-visible">
      <defs>
        <mask id={`ppre-${id}`} maskUnits="userSpaceOnUse" x="-60" y="-60" width="528" height="520">
          <rect x="-60" y="-60" width="528" height="520" fill="white" />
          <path d={FEET_GAP} fill="black" />
          <motion.ellipse cx="169.5" cy="157" rx="16.5" ry="27" fill="black" animate={{ scaleY: eyeScale }} transition={eyeT} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
          <motion.ellipse cx="230" cy="154" rx="15.5" ry="26.5" fill="black" animate={{ scaleY: eyeScale }} transition={eyeT} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
          {pupil && !lookUp && !blink && EYES.map(([cx, cy], k) => <motion.ellipse key={k} rx="8.5" ry="12.5" fill="white"
            initial={false} animate={{ cx: cx + pupil.x, cy: cy + pupil.y }} transition={still ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 22 }} />)}
          {lookUp && !blink && <>
            <ellipse cx="178" cy="146" rx="8" ry="12" fill="white" />
            <ellipse cx="238" cy="143" rx="8" ry="12" fill="white" />
          </>}
          {lookUp ? <circle cx="201" cy="206" r="10" fill="black" /> : <path d={SMILE} fill="black" />}
        </mask>
      </defs>
      <motion.g animate={m.figure} style={pivot(204, 390)}>
        <motion.g animate={{ ...m.left, opacity: cover ? 0 : 1 }} style={pivot(112, 200)}><path d={LEFT_ARM} fill={color} /></motion.g>
        <motion.g animate={{ ...m.right, opacity: cover ? 0 : 1 }} style={pivot(272, 196)}><path d={rightArm} fill={color} /></motion.g>
        <motion.g animate={m.body} style={pivot(204, 330)}>
          <g mask={`url(#ppre-${id})`} fill={color}>
            <path d={TORSO} />
            <path d={FEET} />
          </g>
        </motion.g>
        <AnimatePresence>{cover && <Hands key="hands" color={color} peek={!!peek} still={still} />}</AnimatePresence>
        {pose === "celebrate" && !still && <Sparkles />}
        {pose === "think" && !still && <ThinkDots />}
      </motion.g>
    </motion.svg>
    <AnimatePresence>
      {say && <motion.div key={String(typeof say === "string" ? say : "say")}
        initial={{ opacity: 0, scale: 0.85, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className={cn("absolute z-10 w-max max-w-[min(15rem,70vw)] rounded-2xl px-3.5 py-2 text-sm font-semibold leading-snug text-ink shadow-lift",
          saySide === "right" && "bottom-[78%] left-[62%] origin-bottom-left",
          saySide === "left" && "bottom-[78%] right-[62%] origin-bottom-right",
          saySide === "top" && "bottom-[96%] left-1/2 -translate-x-1/2 origin-bottom",
          sayTone === "lime" ? "bg-lime text-navy" : "bg-white")}>
        {say}
        <span aria-hidden className={cn("absolute -bottom-[6px] size-3.5 rotate-45 rounded-[3px]",
          saySide === "right" && "left-4", saySide === "left" && "right-4", saySide === "top" && "left-1/2 -ml-2",
          sayTone === "lime" ? "bg-lime" : "bg-white")} />
      </motion.div>}
    </AnimatePresence>
  </div>;
}

/** Where the pupils sit inside the eyes (SVG units), turned towards `lookAt`. null = no pupils (the classic look). */
function usePupil(box: RefObject<HTMLDivElement | null>, lookAt: { x: number; y: number } | null | undefined, size: number) {
  const [p, setP] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (lookAt === undefined) { setP(null); return; }
    const r = box.current?.getBoundingClientRect();
    if (!lookAt || !r) { setP({ x: 0, y: 4 }); return; }
    // eyes are about 39% down the figure; the further the point, the closer to the edge of the eye
    const dx = lookAt.x - (r.left + r.width / 2), dy = lookAt.y - (r.top + r.height * 0.39);
    const d = Math.hypot(dx, dy) || 1, k = d / (d + size * 0.6);
    setP({ x: (dx / d) * k * 7, y: (dy / d) * k * 11 });
  }, [lookAt?.x, lookAt?.y, lookAt === null, lookAt === undefined, size]); // eslint-disable-line react-hooks/exhaustive-deps
  return p;
}

/** Both hands over the eyes (pose "cover"): arms from the shoulders, mittens on the eyes, a soft outline so they
    read against a body of the same colour. `peek` slides them down so the top of the eyes shows. */
function Hands({ color, peek, still }: { color: string; peek: boolean; still: boolean }) {
  const line = "rgb(8 7 43 / 0.22)";
  const t: Transition = still ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 24 };
  return <motion.g initial={{ y: 90, opacity: 0 }} animate={{ y: peek ? 26 : 0, opacity: 1 }} exit={{ y: 90, opacity: 0 }} transition={t}>
    {[["M110 236 Q120 200 160 172", 168, 158, -12], ["M290 232 Q282 196 240 168", 234, 155, 12]].map(([d, cx, cy, rot], k) => <g key={k}>
      <path d={d as string} fill="none" stroke={line} strokeWidth="40" strokeLinecap="round" />
      <path d={d as string} fill="none" stroke={color} strokeWidth="32" strokeLinecap="round" />
      <ellipse cx={cx as number} cy={cy as number} rx="31" ry="35" fill={color} stroke={line} strokeWidth="4" transform={`rotate(${rot} ${cx} ${cy})`} />
    </g>)}
  </motion.g>;
}

function useBlink(still: boolean) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (still) return;
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => { setClosed(true); window.setTimeout(() => setClosed(false), 130); loop(); }, 2400 + Math.random() * 2600);
    };
    loop();
    return () => window.clearTimeout(t);
  }, [still]);
  return closed;
}

function Sparkles() {
  const stars = [[40, 40, 0], [360, 30, 0.2], [380, 220, 0.4], [20, 200, 0.6], [200, -30, 0.3]] as const;
  return <g>{stars.map(([x, y, d], i) => <motion.path key={i} d="M0 -16 4 -4 16 0 4 4 0 16 -4 4 -16 0 -4 -4Z"
    fill={i % 2 ? "var(--color-lime)" : "var(--color-brand-300)"}
    initial={{ x, y, scale: 0 }} animate={{ x, y, scale: [0, 1.3, 0], rotate: [0, 90] }}
    transition={{ duration: 1.2, delay: d, repeat: Infinity, repeatDelay: 0.4 }} />)}</g>;
}

function ThinkDots() {
  return <g>{[0, 1, 2].map((i) => <motion.circle key={i} cx={300 + i * 30} cy={40 - i * 14} r={8 + i * 3}
    fill="var(--color-brand-200)"
    animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.4, delay: i * 0.25, repeat: Infinity }} />)}</g>;
}
