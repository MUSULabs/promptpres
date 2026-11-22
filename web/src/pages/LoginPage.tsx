import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Message } from "../components/ui";

export default function LoginPage() {
  const [params] = useSearchParams();
  const [register, setRegister] = useState(params.get("mode") === "register");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const { refresh, state } = useAuth(); const navigate = useNavigate();
  async function submit(event?: FormEvent, guest = false) {
    event?.preventDefault(); setBusy(true); setError("");
    try {
      if (guest) await api.guest();
      else if (register) await api.register(email, name, password);
      else await api.login(email, password);
      await refresh();
      const next = params.get("next") || "/";
      navigate(next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/", { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : "เข้าสู่ระบบไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <section className="panel login-panel"><h1>{register ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</h1>
    {state?.user?.is_guest && <p>สมัครสมาชิกจากเบราว์เซอร์นี้เพื่อเก็บประวัติรอบทดลองใช้ของคุณต่อได้</p>}
    {state?.user?.is_guest && !register && <p role="note">รอบทดลองใช้ย้ายไปบัญชีใหม่เฉพาะเมื่อสมัครสมาชิก — หากเข้าสู่ระบบบัญชีเดิม รอบทดลองใช้ในเบราว์เซอร์นี้จะไม่ย้ายตามไป</p>}
    <div className="tabs" role="group" aria-label="โหมดบัญชี">
      <button className="segment" onClick={() => setRegister(false)} aria-pressed={!register}>เข้าสู่ระบบ</button>
      <button className="segment" onClick={() => setRegister(true)} aria-pressed={register}>สมัครสมาชิก</button>
    </div>
    <form onSubmit={(e) => void submit(e)}>
      {register && <label>ชื่อที่แสดง<input required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>}
      <label>อีเมล<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)<input type="password" required minLength={8} maxLength={128}
        autoComplete={register ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <Message kind="error">{error}</Message>}
      <button className="button" type="submit" disabled={busy}>{busy ? "กำลังดำเนินการ…" : register ? "สร้างบัญชี" : "เข้าสู่ระบบ"}</button>
    </form>
    <button className="button secondary" disabled={busy} onClick={() => void submit(undefined, true)}>ทดลองใช้งานทันที (สำหรับคณะกรรมการ / ผู้ทดสอบ)</button>
  </section>;
}
