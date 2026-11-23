/* Login / register / one-click Guest card. Checks fields as the user types (rules mirror api/app/auth.py:
   email 3-254 chars, password 8-128, display name 1-80) and says exactly what to fix. Demo only: nothing is sent. */
import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Info, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Button, cn, Logo } from "./ui";
import { ErrorPanel } from "./states";
import { PREF, writePref } from "./prefs";

type Tab = "login" | "register";

export function AuthCard({ className, initialTab = "login", hideLogo }: { className?: string; initialTab?: Tab; hideLogo?: boolean }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);

  const errs = {
    name: tab === "register" && !name.trim() ? "ใส่ชื่อที่จะแสดงในระบบ" : null,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "รูปแบบอีเมลไม่ถูกต้อง เช่น name@up.ac.th" : null,
    pw: pw.length < 8 ? `รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร (ตอนนี้ ${pw.length})` : pw.length > 128 ? "รหัสผ่านยาวเกิน 128 ตัวอักษร" : null,
  };
  const ok = !errs.name && !errs.email && !errs.pw;
  const submit = () => {
    setTouched({ name: true, email: true, pw: true });
    if (!ok) return;
    if (tab === "login" && pw === "wrongpass") { setFailed(true); return; } // demo: type "wrongpass" to see the wrong-password state
    if (tab === "register" && name.trim()) writePref(PREF.name, name.trim());
    writePref(PREF.signedIn, "1");
    nav("/lab/dashboard");
  };

  return <div className={cn("w-full max-w-md rounded-panel bg-white p-6 text-ink shadow-[0_40px_80px_-30px_rgb(0_0_0/0.6)] sm:p-8", className)}>
    {!hideLogo && <Logo className="mb-6 h-6" />}
    <Button size="lg" variant="lime" className="w-full" onClick={() => { writePref(PREF.signedIn, "1"); nav("/lab/dashboard?tour=1"); }}>ทดลองใช้งานทันที (Guest) <ArrowRight /></Button>
    <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0 text-brand" />ไม่ต้องสมัคร วิดีโอของ Guest เก็บไว้ 7 วัน สมัครภายหลังได้ รอบซ้อมเดิมจะย้ายเข้าบัญชีให้</p>
    <div className="my-5 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />หรือใช้บัญชี<span className="h-px flex-1 bg-line" /></div>
    <div className="mb-4 grid grid-cols-2 rounded-full bg-surface p-1" role="tablist">
      {(["login", "register"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setFailed(false); setTouched({}); }}
        className={cn("rounded-full py-2 text-sm font-semibold transition-colors", tab === t ? "bg-white text-brand shadow-card" : "text-muted")}>{t === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</button>)}
    </div>
    {failed && <ErrorPanel className="mb-4" what="อีเมลหรือรหัสผ่านไม่ถูกต้อง" todo="ตรวจแป้น Caps Lock หรือภาษาไทย/อังกฤษ แล้วลองอีกครั้ง ถ้ายังไม่มีบัญชีให้สมัครก่อน"
      actions={<Button size="sm" variant="soft" onClick={() => { setTab("register"); setFailed(false); }}>สมัครสมาชิก</Button>} />}
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {tab === "register" && <Field Icon={UserRound} label="ชื่อที่แสดง" value={name} onChange={setName} onBlur={() => setTouched({ ...touched, name: true })} error={touched.name ? errs.name : null} autoComplete="nickname" maxLength={80} />}
      <Field Icon={Mail} label="อีเมล" type="email" value={email} onChange={setEmail} onBlur={() => setTouched({ ...touched, email: true })} error={touched.email ? errs.email : null} autoComplete="email" maxLength={254} />
      <Field Icon={LockKeyhole} label="รหัสผ่าน" type={show ? "text" : "password"} value={pw} onChange={setPw} onBlur={() => setTouched({ ...touched, pw: true })}
        error={touched.pw ? errs.pw : null} hint={tab === "register" ? "อย่างน้อย 8 ตัวอักษร" : undefined} autoComplete={tab === "login" ? "current-password" : "new-password"} maxLength={128}
        trailing={<button type="button" onClick={() => setShow(!show)} aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} className="grid size-8 place-items-center rounded-lg text-faint hover:text-ink">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>} />
      <Button className="w-full" size="lg" type="submit">{tab === "login" ? "เข้าสู่ระบบ" : "สมัครและเริ่มซ้อม"}</Button>
      <p className="text-center text-xs text-faint">กดดำเนินการต่อถือว่ายอมรับ <Link to="/lab/privacy" className="font-semibold text-brand hover:underline">ข้อตกลงและนโยบายความเป็นส่วนตัว</Link></p>
    </form>
  </div>;
}

function Field({ Icon, label, type = "text", value, onChange, onBlur, error, hint, trailing, autoComplete, maxLength }: {
  Icon: typeof Mail; label: string; type?: string; value: string; onChange: (v: string) => void; onBlur: () => void;
  error: string | null; hint?: string; trailing?: ReactNode; autoComplete?: string; maxLength?: number;
}) {
  const id = `auth-${useId().replace(/:/g, "")}`;
  // the label wraps only the text, so the show-password button does not become part of the field's name
  return <div>
    <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
    <span className={cn("flex items-center gap-2 rounded-xl bg-surface pl-3 pr-1 ring-1 ring-inset transition-shadow focus-within:bg-white focus-within:ring-2",
      error ? "ring-navy focus-within:ring-navy" : "ring-line focus-within:ring-brand")}>
      <Icon className="size-4 shrink-0 text-faint" />
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined}
        autoComplete={autoComplete} maxLength={maxLength} className="h-11 w-full min-w-0 bg-transparent outline-none" />
      {trailing}
    </span>
    {(error || hint) && <span id={`${id}-msg`} className={cn("mt-1 block text-xs", error ? "font-semibold text-ink" : "text-faint")}>{error ? `⚠ ${error}` : hint}</span>}
  </div>;
}
