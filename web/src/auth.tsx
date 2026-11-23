/* Who is signed in (GET /api/auth/me), shared by the whole app.
   - AuthGate sends a visitor to /login?next=… when the site requires an account (cloud mode);
   - /logout signs out, then reloads at /login (a fresh page drops everything the old account had loaded).
     Links reach /logout through the router, so a page that holds unsent work (useLeaveGuard) asks first
     and nothing is signed out if the person stays. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api, type AuthState } from "./api";
import { Button, Logo } from "./v2/ui";
import { ErrorPanel, PageSkeleton } from "./v2/states";
import { PATH } from "./v2/paths";

const Context = createContext<{ state: AuthState | null; refresh: () => Promise<void> }>({ state: null, refresh: async () => {} });
export const useAuth = () => useContext(Context);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setState(await api.me()); setError(false); } catch { setError(true); } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => void refresh();
    window.addEventListener("pt-auth-expired", update);
    return () => window.removeEventListener("pt-auth-expired", update);
  }, [refresh]);
  if (error && !state) return <main id="main-content" className="grid min-h-dvh place-items-center bg-surface px-4">
    <div className="w-full max-w-md">
      <Logo className="mx-auto mb-6 h-7" />
      <ErrorPanel what="ติดต่อระบบบัญชีไม่ได้" why="เครือข่ายขาดหาย หรือเซิร์ฟเวอร์กำลังเริ่มทำงาน (อาจใช้เวลาราว 30 วินาที)" todo="ตรวจการเชื่อมต่อ แล้วกดลองใหม่"
        actions={<Button size="sm" onClick={() => void refresh()} disabled={busy}><RefreshCw className={busy ? "animate-spin" : undefined} />ลองใหม่</Button>} />
    </div>
  </main>;
  return <Context.Provider value={{ state, refresh }}>{children}</Context.Provider>;
}

/** The name and kind of account shown in the app frame, greeting, settings and share card. */
export function useAccount() {
  const user = useAuth().state?.user ?? null;
  return {
    user,
    name: user?.display_name?.trim() || (user?.is_guest ? "Guest" : "ผู้ใช้ทดลอง"),
    isGuest: !!user?.is_guest,
  };
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { pathname, search } = useLocation();
  if (!state) return <PageSkeleton />;
  if (state.required && !state.user) return <Navigate to={`${PATH.login}?next=${encodeURIComponent(pathname + search)}`} replace />;
  return <>{children}</>;
}

export function LogoutPage() {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    api.logout().then(() => { if (live) window.location.replace(PATH.login); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);
  return <main id="main-content" className="grid min-h-dvh place-items-center bg-surface px-4">
    <div className="w-full max-w-md text-center">
      <Logo className="mx-auto mb-6 h-7" />
      {!failed ? <p role="status" className="text-muted">กำลังออกจากระบบ…</p>
        : <ErrorPanel className="text-left" what="ออกจากระบบไม่สำเร็จ" why="ติดต่อเซิร์ฟเวอร์ไม่ได้" todo="ตรวจการเชื่อมต่อแล้วลองใหม่"
            actions={<>
              <Button size="sm" onClick={() => setAttempt((n) => n + 1)}><RefreshCw />ลองใหม่</Button>
              <Button size="sm" variant="soft" asChild><Link to={PATH.home}>กลับหน้าหลัก</Link></Button>
            </>} />}
    </div>
  </main>;
}
