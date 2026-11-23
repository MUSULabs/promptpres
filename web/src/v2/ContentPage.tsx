/* Frame for public reading pages (privacy, about, help, how we measure): light header with the logo,
   a sticky table of contents on wide screens, and a navy footer that links every page. */
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowLeft, Menu, X } from "lucide-react";
import { Button, cn, Logo } from "./ui";
import { useAuth } from "@/auth";
import { PATH } from "./paths";

/** Where "home" is for this visitor: "/" is the dashboard once they can use the app, else the landing page. */
export function useHome() {
  const { state } = useAuth();
  const inside = !!state && (!!state.user || !state.required);
  return inside ? { to: PATH.home, back: "กลับหน้าหลัก", cta: "ไปหน้าหลัก", ctaTo: PATH.home } : { to: PATH.home, back: "กลับหน้าแรก", cta: "เริ่มใช้งานฟรี", ctaTo: PATH.login };
}

export const SITE_LINKS = [
  { to: PATH.about, label: "เกี่ยวกับ" },
  { to: PATH.how, label: "เราวัดผลอย่างไร" },
  { to: PATH.help, label: "ช่วยเหลือ" },
  { to: PATH.privacy, label: "ความเป็นส่วนตัว" },
];

export interface Section { id: string; title: string; body: ReactNode }

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const home = useHome();
  return <header className="sticky top-0 z-30 border-b border-line/70 bg-white/85 backdrop-blur-md">
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
      <Link to={home.to} aria-label="PromptPre's หน้าแรก"><Logo className="h-7" /></Link>
      <nav className="hidden items-center gap-1 md:flex">
        {SITE_LINKS.map((l) => <NavLink key={l.to} to={l.to} className={({ isActive }) => cn("rounded-full px-3.5 py-2 text-sm font-medium transition-colors", isActive ? "bg-brand-50 text-brand" : "text-muted hover:text-ink")}>{l.label}</NavLink>)}
      </nav>
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="primary" className="hidden sm:inline-flex"><Link to={home.ctaTo}>{home.cta}</Link></Button>
        <button type="button" onClick={() => setOpen(!open)} aria-label="เมนู" aria-expanded={open} className="grid size-10 place-items-center rounded-full bg-surface md:hidden">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
      </div>
    </div>
    {open && <nav className="border-t border-line bg-white px-4 py-3 md:hidden">
      {SITE_LINKS.map((l) => <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)} className={({ isActive }) => cn("block rounded-xl px-3 py-2.5 font-medium", isActive ? "bg-brand-50 text-brand" : "text-ink")}>{l.label}</NavLink>)}
      <Button asChild className="mt-2 w-full"><Link to={home.ctaTo}>{home.cta}</Link></Button>
    </nav>}
  </header>;
}

export function SiteFooter() {
  return <footer className="bg-navy text-white">
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
      <div>
        <Logo dark className="h-8" />
        <p className="mt-3 max-w-sm text-sm text-white/65">ระบบวิเคราะห์พฤติกรรมการซ้อมนำเสนอ โครงงานวิทยาการคอมพิวเตอร์ มหาวิทยาลัยพะเยา</p>
      </div>
      <div>
        <p className="text-sm font-semibold text-lime">เว็บไซต์</p>
        <ul className="mt-3 space-y-2 text-sm text-white/75">{SITE_LINKS.map((l) => <li key={l.to}><Link to={l.to} className="hover:text-white">{l.label}</Link></li>)}</ul>
      </div>
      <div>
        <p className="text-sm font-semibold text-lime">ใช้งาน</p>
        <ul className="mt-3 space-y-2 text-sm text-white/75">
          <li><Link to={PATH.login} className="hover:text-white">เข้าสู่ระบบ / สมัคร</Link></li>
          <li><Link to={PATH.new} className="hover:text-white">ซ้อมรอบใหม่</Link></li>
          <li><Link to={PATH.contact} className="hover:text-white">แจ้งปัญหา</Link></li>
        </ul>
      </div>
    </div>
    <p className="border-t border-white/10 px-4 py-5 text-center text-xs text-white/45">© 2569 PromptPre's · ไม่มีคะแนนรวม ไม่มีเกรด · ระดับที่ระบบวัดได้ ไม่ใช่การตัดสินตัวคุณ</p>
  </footer>;
}

export function ContentPage({ eyebrow, title, intro, updated, sections, aside, children }: {
  eyebrow: string; title: ReactNode; intro?: ReactNode; updated?: string; sections: Section[]; aside?: ReactNode; children?: ReactNode;
}) {
  const [active, setActive] = useState(sections[0]?.id);
  const home = useHome();
  useEffect(() => {
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id); },
      { rootMargin: "-20% 0px -65% 0px" });
    sections.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [sections.map((s) => s.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="min-h-dvh bg-surface">
    <SiteHeader />
    <main id="main-content" tabIndex={-1} className="outline-none">
    <section className="relative overflow-hidden bg-navy-gradient text-white">
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
        <Link to={home.to} className="inline-flex items-center gap-1.5 text-sm text-white/65 hover:text-white"><ArrowLeft className="size-4" />{home.back}</Link>
        <p className="mt-6 text-sm font-semibold text-lime">{eyebrow}</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">{title}</h1>
        {intro && <div className="mt-4 max-w-2xl text-white/75 sm:text-lg">{intro}</div>}
        {updated && <p className="mt-5 text-xs text-white/50">ปรับปรุงล่าสุด {updated}</p>}
      </div>
    </section>
    <div className="mx-auto -mt-8 grid max-w-6xl grid-cols-1 gap-8 px-4 pb-20 sm:px-6 lg:grid-cols-[220px_1fr]">
      <nav className="hidden lg:block" aria-label="สารบัญ">
        <div className="sticky top-24 rounded-2xl bg-white p-3 shadow-card">
          <p className="px-3 pb-2 pt-1 text-xs font-semibold text-faint">ในหน้านี้</p>
          {sections.map((s) => <a key={s.id} href={`#${s.id}`} className={cn("block rounded-lg px-3 py-2 text-sm transition-colors", active === s.id ? "bg-brand-50 font-semibold text-brand" : "text-muted hover:text-ink")}>{s.title}</a>)}
          {aside}
        </div>
      </nav>
      <div className="min-w-0 space-y-5">
        {sections.map((s) => <section key={s.id} id={s.id} className="card scroll-mt-24 p-6 sm:p-8">
          <h2 className="text-xl font-bold sm:text-2xl">{s.title}</h2>
          <div className="prose-v2 mt-3">{s.body}</div>
        </section>)}
        {children}
      </div>
    </div>
    </main>
    <SiteFooter />
  </div>;
}
