/* Login / register / one-click Guest card (POST /api/auth/login | register | guest). Checks fields as the user
   types (rules mirror api/app/auth.py: email 3-254 chars, password 8-128, display name 1-80) and says exactly what
   to fix. Google / LINE / GitHub are shown but not connected yet: pressing one says so in place and sends nothing. */
import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Info, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { api, ApiError } from "@/api";
import { useAuth } from "@/auth";
import { Button, cn, Logo } from "./ui";
import { ErrorPanel } from "./states";
import { PATH } from "./paths";

type Tab = "login" | "register";
export type AuthField = "name" | "email" | "pw" | null;
/** What the card is doing, for P'Pre on the login page: which field has focus, how long the text is, password shown. */
export interface AuthLook { field: AuthField; el: HTMLInputElement | null; show: boolean }

export function AuthCard({ className, initialTab = "login", hideLogo, next = PATH.home, onLook }: {
  className?: string; initialTab?: Tab; hideLogo?: boolean; next?: string; onLook?: (l: AuthLook) => void;
}) {
  const nav = useNavigate();
  const { state, refresh } = useAuth();
  const guestNow = !!state?.user?.is_guest;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"guest" | "form" | null>(null);
  const [error, setError] = useState<{ what: string; todo?: string; status: number } | null>(null);
  const [soon, setSoon] = useState<string | null>(null);

  const errs = {
    name: tab === "register" && !name.trim() ? "ใส่ชื่อที่จะแสดงในระบบ" : null,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "รูปแบบอีเมลไม่ถูกต้อง เช่น name@up.ac.th" : null,
    pw: pw.length < 8 ? `รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร (ตอนนี้ ${pw.length})` : pw.length > 128 ? "รหัสผ่านยาวเกิน 128 ตัวอักษร" : null,
  };
  const ok = !errs.name && !errs.email && !errs.pw;

  async function run(kind: "guest" | "form") {
    setBusy(kind); setError(null); setSoon(null);
    try {
      if (kind === "guest") await api.guest();
      else if (tab === "register") await api.register(email.trim(), name.trim(), pw);
      else await api.login(email.trim(), pw);
      await refresh();
      nav(next, { replace: true });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      const message = e instanceof Error ? e.message : "เข้าสู่ระบบไม่สำเร็จ";
      setError(status === 401 && tab === "login" && kind === "form"
        ? { status, what: "อีเมลหรือรหัสผ่านไม่ถูกต้อง", todo: "ตรวจแป้น Caps Lock หรือภาษาไทย/อังกฤษ แล้วลองอีกครั้ง ถ้ายังไม่มีบัญชีให้สมัครก่อน" }
        : { status, what: message, todo: status === 0 ? "ตรวจการเชื่อมต่อแล้วกดอีกครั้ง" : undefined });
      setBusy(null);
    }
  }
  const submit = () => { setTouched({ name: true, email: true, pw: true }); if (ok) void run("form"); };
  const look = (field: AuthField, el: HTMLInputElement | null, shown = show) => onLook?.({ field, el, show: shown });

  return <div className={cn("w-full max-w-md rounded-panel bg-white p-6 text-ink shadow-[0_40px_80px_-30px_rgb(0_0_0/0.6)] sm:p-8", className)} data-auth-card>
    {!hideLogo && <Logo className="mb-6 h-6" />}
    {guestNow && <p className="mb-4 rounded-2xl bg-lime/30 px-4 py-3 text-sm text-navy">คุณกำลังใช้แบบ Guest สมัครสมาชิกจากเบราว์เซอร์นี้เพื่อเก็บประวัติรอบซ้อมไว้ต่อ</p>}
    {!guestNow && <>
      <Button size="lg" variant="lime" className="w-full" disabled={!!busy} onClick={() => void run("guest")}
        aria-label="ทดลองใช้งานทันที แบบ Guest ไม่ต้องสมัคร">{busy === "guest" ? <Loader2 className="animate-spin" /> : null}ทดลองใช้งานทันที (Guest) <ArrowRight /></Button>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0 text-brand" />ไม่ต้องสมัคร วิดีโอของ Guest เก็บไว้ 7 วัน สมัครภายหลังได้ รอบซ้อมเดิมจะย้ายเข้าบัญชีให้</p>
    </>}
    <SocialButtons soon={soon} onPick={(p) => { setSoon(p); setError(null); }} />
    <div className="my-5 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />หรือใช้อีเมล<span className="h-px flex-1 bg-line" /></div>
    <div className="mb-4 grid grid-cols-2 rounded-full bg-surface p-1" role="tablist" aria-label="โหมดบัญชี">
      {(["login", "register"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setError(null); setTouched({}); }}
        className={cn("min-h-10 rounded-full text-sm font-semibold transition-colors", tab === t ? "bg-white text-brand shadow-card" : "text-muted")}>{t === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</button>)}
    </div>
    {guestNow && tab === "login" && <p role="note" className="mb-4 flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0 text-brand" />รอบทดลองใช้ย้ายไปบัญชีใหม่เฉพาะเมื่อสมัครสมาชิก หากเข้าสู่ระบบบัญชีเดิม รอบทดลองใช้ในเบราว์เซอร์นี้จะไม่ย้ายตามไป</p>}
    {error && <ErrorPanel className="mb-4" what={error.what} todo={error.todo}
      actions={error.status === 401 && tab === "login" ? <Button size="sm" variant="soft" onClick={() => { setTab("register"); setError(null); }}>สมัครสมาชิก</Button> : undefined} />}
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {tab === "register" && <Field Icon={UserRound} label="ชื่อที่แสดง" value={name} onChange={setName} onBlur={() => { setTouched({ ...touched, name: true }); look(null, null); }}
        onFocus={(el) => look("name", el)} error={touched.name ? errs.name : null} autoComplete="nickname" maxLength={80} />}
      <Field Icon={Mail} label="อีเมล" type="email" value={email} onChange={setEmail} onBlur={() => { setTouched({ ...touched, email: true }); look(null, null); }}
        onFocus={(el) => look("email", el)} error={touched.email ? errs.email : null} autoComplete="email" maxLength={254} />
      <Field Icon={LockKeyhole} label="รหัสผ่าน" type={show ? "text" : "password"} value={pw} onChange={setPw} onBlur={() => { setTouched({ ...touched, pw: true }); look(null, null); }}
        onFocus={(el) => look("pw", el)} error={touched.pw ? errs.pw : null} hint={tab === "register" ? "อย่างน้อย 8 ตัวอักษร" : undefined}
        autoComplete={tab === "login" ? "current-password" : "new-password"} maxLength={128}
        trailing={<button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => {
          const shown = !show; setShow(shown);
          const input = (e.currentTarget.parentElement?.querySelector("input") ?? null) as HTMLInputElement | null;
          look("pw", input, shown);
        }} aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={show} className="grid size-10 place-items-center rounded-lg text-faint hover:text-ink">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>} />
      <Button className="w-full" size="lg" type="submit" disabled={!!busy}>{busy === "form" && <Loader2 className="animate-spin" />}{busy === "form" ? "กำลังดำเนินการ…" : tab === "login" ? "เข้าสู่ระบบ" : "สมัครและเริ่มซ้อม"}</Button>
      <p className="text-center text-xs text-faint">กดดำเนินการต่อถือว่ายอมรับ <Link to={PATH.privacy} className="font-semibold text-brand hover:underline">ข้อตกลงและนโยบายความเป็นส่วนตัว</Link></p>
    </form>
  </div>;
}

/* ---------- Google / LINE / GitHub (coming soon) ---------- */

const PROVIDERS = [
  { key: "Google", Logo: GoogleLogo },
  { key: "LINE", Logo: LineLogo },
  { key: "GitHub", Logo: GitHubLogo },
] as const;

function SocialButtons({ soon, onPick }: { soon: string | null; onPick: (p: string) => void }) {
  return <div className="mt-4" data-social>
    <div className="grid grid-cols-3 gap-2">
      {PROVIDERS.map(({ key, Logo: Mark }) => <button key={key} type="button" onClick={() => onPick(key)} aria-describedby={soon === key ? "social-soon" : undefined}
        aria-label={`ดำเนินการต่อด้วย ${key} (เร็ว ๆ นี้)`}
        className={cn("flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-ink ring-1 ring-inset ring-line transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-card",
          soon === key && "ring-2 ring-brand")}>
        <Mark />{key}
      </button>)}
    </div>
    {soon && <p id="social-soon" role="status" className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand">
      เข้าสู่ระบบด้วย {soon} จะเปิดเร็ว ๆ นี้ ระหว่างนี้ใช้ Guest หรืออีเมลได้</p>}
  </div>;
}

// Provider marks in the colours their brand rules ask for, on a white button.
function GoogleLogo() {
  return <svg aria-hidden viewBox="0 0 48 48" className="size-[18px]"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>;
}
function LineLogo() {
  return <svg aria-hidden viewBox="0 0 48 48" className="size-[18px]"><rect width="48" height="48" rx="11" fill="#06C755" /><path fill="#fff" d="M40 22.3C40 15.5 33.2 10 24.8 10S9.6 15.5 9.6 22.3c0 6.1 5.4 11.2 12.7 12.2.5.1 1.2.3 1.3.8.2.4.1 1 0 1.4l-.2 1.3c-.1.4-.3 1.5 1.3.8s8.7-5.1 11.8-8.8c2.2-2.4 3.5-4.9 3.5-7.7z" /><path fill="#06C755" d="M18.3 19h-1.1c-.2 0-.3.1-.3.3v6.8c0 .2.1.3.3.3h1.1c.2 0 .3-.1.3-.3v-6.8c0-.2-.1-.3-.3-.3zm7.4 0h-1.1c-.2 0-.3.1-.3.3v4l-3.1-4.2-.1-.1h-1.2c-.2 0-.3.1-.3.3v6.8c0 .2.1.3.3.3H21c.2 0 .3-.1.3-.3v-4l3.1 4.2.1.1h1.2c.2 0 .3-.1.3-.3v-6.8c0-.2-.1-.3-.3-.3zm-10.1 5.7h-3v-5.4c0-.2-.1-.3-.3-.3h-1.1c-.2 0-.3.1-.3.3v6.8c0 .1 0 .2.1.2.1.1.1.1.2.1h4.4c.2 0 .3-.1.3-.3v-1.1c0-.2-.1-.3-.3-.3zm16.3-4c.2 0 .3-.1.3-.3v-1.1c0-.2-.1-.3-.3-.3h-4.4c-.1 0-.2 0-.2.1-.1.1-.1.1-.1.2v6.8c0 .1 0 .2.1.2.1.1.1.1.2.1h4.4c.2 0 .3-.1.3-.3v-1.1c0-.2-.1-.3-.3-.3h-3v-1.2h3c.2 0 .3-.1.3-.3V22c0-.2-.1-.3-.3-.3h-3v-1.1h3z" /></svg>;
}
function GitHubLogo() {
  return <svg aria-hidden viewBox="0 0 24 24" className="size-[18px]"><path fill="#181717" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" /></svg>;
}

function Field({ Icon, label, type = "text", value, onChange, onBlur, onFocus, error, hint, trailing, autoComplete, maxLength }: {
  Icon: typeof Mail; label: string; type?: string; value: string; onChange: (v: string) => void; onBlur: () => void; onFocus?: (el: HTMLInputElement) => void;
  error: string | null; hint?: string; trailing?: ReactNode; autoComplete?: string; maxLength?: number;
}) {
  const id = `auth-${useId().replace(/:/g, "")}`;
  // the label wraps only the text, so the show-password button does not become part of the field's name
  return <div>
    <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
    <span className={cn("flex items-center gap-2 rounded-xl bg-surface pl-3 pr-1 ring-1 ring-inset transition-shadow focus-within:bg-white focus-within:ring-2",
      error ? "ring-navy focus-within:ring-navy" : "ring-line focus-within:ring-brand")}>
      <Icon className="size-4 shrink-0 text-faint" />
      <input id={id} type={type} value={value} onChange={(e) => { onChange(e.target.value); onFocus?.(e.currentTarget); }} onBlur={onBlur} onFocus={(e) => onFocus?.(e.currentTarget)}
        aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined}
        autoComplete={autoComplete} maxLength={maxLength} className="h-11 w-full min-w-0 bg-transparent outline-none" />
      {trailing}
    </span>
    {(error || hint) && <span id={`${id}-msg`} className={cn("mt-1 block text-xs", error ? "font-semibold text-ink" : "text-faint")}>{error ? `⚠ ${error}` : hint}</span>}
  </div>;
}
