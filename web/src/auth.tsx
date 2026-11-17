import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { api, type AuthState } from "./api";

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
  return <Context.Provider value={{ state, refresh }}>{error ? <p role="alert">ติดต่อระบบบัญชีไม่ได้ <button onClick={() => void refresh()}>ลองใหม่</button></p> : children}</Context.Provider>;
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
  const [error, setError] = useState("");
  async function logout() { try { await api.logout(); await refresh(); window.location.assign("/login"); }
    catch { setError("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่"); } }
  return <div className="account-menu">{state?.user ? <>
    <span>{state.user.display_name}</span>{state.user.is_guest && <Link to="/login?mode=register">สมัครสมาชิกเพื่อเก็บประวัติ</Link>}
    <button className="button secondary" onClick={() => void logout()}>ออกจากระบบ</button>
  </> : <Link to="/login">เข้าสู่ระบบ</Link>}{error && <span role="alert">{error}</span>}</div>;
}
