import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
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
export function AccountMenu() {
  const { state, refresh } = useAuth();
  const { pathname } = useLocation();
  const [error, setError] = useState("");
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
  async function logout() { try { await api.logout(); await refresh(); window.location.assign("/login"); }
    catch { setError("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่"); } }
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
      <button className="quiet" onClick={() => void logout()}>ออกจากระบบ</button>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  </details>;
}
