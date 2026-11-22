import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, type AuthState } from "./api";
import { Icon, Message } from "./components/ui";

const Context = createContext<{ state: AuthState | null; refresh: () => Promise<void> }>({ state: null, refresh: async () => {} });
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState(false);
  async function refresh() {
    try { setState(await api.me()); setError(false); } catch { setError(true); }
  }
  useEffect(() => { void refresh(); const update = () => void refresh(); window.addEventListener("pt-auth-expired", update);
    return () => window.removeEventListener("pt-auth-expired", update); }, []);
  return <Context.Provider value={{ state, refresh }}>
    {error ? <div className="app-shell"><main id="main-content">
      <Message kind="error">ติดต่อระบบบัญชีไม่ได้</Message>
      <button className="ghost" onClick={() => void refresh()}><Icon name="refresh" /> ลองใหม่</button>
    </main></div> : children}
  </Context.Provider>;
}
export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (!state) return <p role="status">กำลังตรวจสอบบัญชี…</p>;
  if (state.required && !state.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}
/**
 * /logout signs out, then reloads at /login (a fresh page drops everything the old account had loaded).
 * The menu gets here through the router, so a page that holds unsent work (useLeaveGuard) asks first
 * and nothing is signed out if the person stays.
 */
export function LogoutPage() {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    api.logout().then(() => { if (live) window.location.replace("/login"); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);
  if (!failed) return <p role="status" className="muted">กำลังออกจากระบบ…</p>;
  return <section className="panel empty-state">
    <Message kind="error">ออกจากระบบไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่</Message>
    <div className="row">
      <button className="ghost" onClick={() => setAttempt((n) => n + 1)}><Icon name="refresh" /> ลองใหม่</button>
      <Link className="button secondary" to="/"><Icon name="history" /> กลับหน้าประวัติ</Link>
    </div>
  </section>;
}

export function AccountMenu() {
  const { state } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const details = menu.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  function logout() {
    if (menu.current) menu.current.open = false;
    navigate("/logout");
  }
  if (!state?.user && pathname === "/login") return null;
  if (!state) return null;
  if (!state.user) return <div className="account-menu"><Link to="/login">เข้าสู่ระบบ</Link></div>;
  return <details className="account-menu" ref={menu} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && event.currentTarget.open) {
      event.currentTarget.open = false;
      summary.current?.focus();
    }
  }}>
    <summary ref={summary} aria-label={`บัญชี ${state.user.display_name}`}>
      <Icon name="user" /><span>{state.user.display_name}</span><Icon name="chevronDown" />
    </summary>
    <div className="account-options">
      {state.user.is_guest && <Link to="/login?mode=register">สมัครสมาชิกเพื่อเก็บประวัติ</Link>}
      <button className="quiet" onClick={logout}>ออกจากระบบ</button>
    </div>
  </details>;
}
