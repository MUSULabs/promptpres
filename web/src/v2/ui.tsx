import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { BookOpenText, Clock3, Mic, PersonStanding, type LucideIcon } from "lucide-react";
import type { CriterionCode, Skill } from "@/contract";
import logoBlue from "@/assets/brand/horizontal.svg";
import logoWhite from "@/assets/brand/horizontal-white.svg";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The PromptPre's wordmark from the brand files (blue on light, white on dark). */
export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  return <img src={dark ? logoWhite : logoBlue} alt="PromptPre's" className={cn("h-7 w-auto select-none", className)} draggable={false} />;
}

/** The four skill groups share the brand blue; they differ by icon and name only. */
export const SKILL_STYLE: Record<Skill, { Icon: LucideIcon; tagline: string }> = {
  content: { Icon: BookOpenText, tagline: "พูดครบ เรียงตามแผน" },
  speech: { Icon: Mic, tagline: "จังหวะ ช่วงหยุด เสียงเติม" },
  body: { Icon: PersonStanding, tagline: "มือ และทิศทางศีรษะ" },
  time: { Icon: Clock3, tagline: "พอดีกับเวลาเป้าหมาย" },
};

export const SKILL_OF: Record<CriterionCode, Skill> = {
  C1: "content", C2: "content", S1: "speech", S2: "speech", S3: "speech", N1: "body", N2: "body", T1: "time",
};

/** Short on-card names (full names stay in presentation.ts CRITERION_NAME). */
export const SHORT_NAME: Record<CriterionCode, string> = {
  C1: "ลำดับหัวข้อ", C2: "ความครอบคลุม", S1: "ความเร็วพูด", S2: "หยุดยาว",
  S3: "เสียงเติม", N1: "ท่าทางมือ", N2: "หันหน้า", T1: "เวลา",
};

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[transform,box-shadow,background-color,color] duration-200 hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white shadow-[0_10px_24px_-10px_rgb(40_35_239/0.7)] hover:bg-brand-700",
        lime: "bg-lime text-navy shadow-[0_10px_24px_-12px_rgb(212_245_60/0.9)] hover:bg-lime-300",
        white: "bg-white text-ink shadow-card hover:shadow-lift",
        soft: "bg-brand-50 text-brand hover:bg-brand-100",
        ghost: "bg-transparent text-ink hover:bg-ink/5 hover:translate-y-0",
        outlineLight: "bg-white/5 text-white ring-1 ring-inset ring-white/30 hover:bg-white/15",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-5 text-[15px]",
        lg: "h-13 px-7 text-base",
        xl: "h-15 px-8 text-lg",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

export function Card({ className, variant = "white", ...props }: HTMLAttributes<HTMLDivElement> & { variant?: "white" | "brand" | "navy" }) {
  const v = { white: "card", brand: "rounded-card bg-brand-gradient text-white shadow-glow", navy: "rounded-card bg-navy text-white" }[variant];
  return <div className={cn(v, "p-5", className)} {...props} />;
}

export function Chip({ children, className, tone = "soft" }: { children: ReactNode; className?: string; tone?: "soft" | "brand" | "lime" | "dark" | "glass" | "line" }) {
  const tones = {
    soft: "bg-brand-50 text-brand",
    brand: "bg-brand text-white",
    lime: "bg-lime text-navy",
    dark: "bg-navy text-white",
    glass: "bg-white/10 text-white ring-1 ring-inset ring-white/20",
    line: "bg-white text-muted ring-1 ring-inset ring-line",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold [&_svg]:size-3.5", tones[tone], className)}>{children}</span>;
}

/** Skill icon in a soft blue tile. */
export function SkillIcon({ skill, className, inverted }: { skill: Skill; className?: string; inverted?: boolean }) {
  const { Icon } = SKILL_STYLE[skill];
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", inverted ? "bg-white/15 text-white" : "bg-brand-50 text-brand", className)}>
    <Icon className="size-5" />
  </span>;
}

export function SectionTitle({ eyebrow, title, children, className, dark }: { eyebrow?: string; title: ReactNode; children?: ReactNode; className?: string; dark?: boolean }) {
  return <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-4", className)}>
    <div>
      {eyebrow && <p className={cn("mb-1 text-sm font-semibold", dark ? "text-lime" : "text-brand")}>{eyebrow}</p>}
      <h2 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h2>
    </div>
    {children}
  </div>;
}
