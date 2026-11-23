import React, { Suspense, lazy, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { NavLink, Route, RouterProvider, Routes, createBrowserRouter, matchPath, useLocation } from "react-router-dom";
import "./brand.css";
import "./styles.css";
import { AuthProvider, AuthGate, AccountMenu, LogoutPage, useAuth } from "./auth";
import LandingPage, { LandingHeader } from "./pages/LandingPage";
import { Brand, Icon, NotFound } from "./components/ui";
import { PageErrorBoundary } from "./components/PageErrorBoundary";

// The landing ships alone; app pages load on first use (a visitor on a phone downloads less before the first paint).
const LoginPage = lazy(() => import("./pages/LoginPage"));
const Home = lazy(() => import("./pages/Home"));
const NewSession = lazy(() => import("./pages/NewSession"));
const SessionVideo = lazy(() => import("./pages/SessionVideo"));
const ResultPage = lazy(() => import("./pages/ResultPage"));

// UX/UI V2 design lab: dev server only. In a build import.meta.env.DEV is false, so the route and its chunk are dropped.
const LabApp = import.meta.env.DEV ? lazy(() => import("./lab/LabApp")) : null;

// A data router (one splat route around the existing <Routes>) so pages can use useBlocker,
// e.g. to ask before leaving an unsent recording (useLeaveGuard.ts).
const router = createBrowserRouter([
  ...(LabApp ? [{ path: "/lab/*", element: <Suspense fallback={null}><LabApp /></Suspense> }] : []),
  { path: "*", element: <AuthProvider><AppShell /></AuthProvider> },
]);

function AppShell() {
  const { pathname } = useLocation();
  const { state } = useAuth();
  const atEntry = pathname === "/";
  const landing = atEntry && state?.required === true && !state.user;
  const checkingEntry = atEntry && !state;

  return (
    <div className={landing ? "pp-v1" : checkingEntry ? undefined : "app-shell"} data-entry-pending={checkingEntry ? "" : undefined}>
      <a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a>
      {landing ? <LandingHeader /> : <SiteHeader checkingEntry={checkingEntry} />}
      <AppRoutes landing={landing} />
    </div>
  );
}

function SiteHeader({ checkingEntry }: { checkingEntry: boolean }) {
  const { pathname } = useLocation();
  const loginPage = pathname === "/login";
  const { state } = useAuth();
  return <header className="site-header">
    <div className="topbar">
      <Brand label={state?.user ? undefined : "PromptPre's — หน้าแรก"} />
      {!loginPage && !checkingEntry && <nav aria-label="เมนูหลัก">
        <NavLink to="/" end>ประวัติ</NavLink>
        <NavLink to="/new"><Icon name="plus" /> ซ้อมใหม่</NavLink>
      </nav>}
      <AccountMenu key={pathname} />
    </div>
  </header>;
}

function AppRoutes({ landing }: { landing: boolean }) {
  const { pathname } = useLocation();
  const resultRoute = matchPath("/sessions/:id", pathname);
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  return <main id="main-content" className={landing ? "landing-main" : resultRoute ? "result-main" : undefined} tabIndex={-1} ref={main}>
    <PageErrorBoundary pathname={pathname}><Suspense fallback={<p role="status" className="muted">กำลังโหลดหน้า…</p>}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/logout" element={<LogoutPage />} />
      <Route path="/" element={landing ? <LandingPage /> : <AuthGate><Home /></AuthGate>} />
      <Route path="/new" element={<AuthGate><NewSession /></AuthGate>} />
      <Route path="/sessions/:id/video" element={<AuthGate><SessionVideo /></AuthGate>} />
      <Route path="/sessions/:id" element={<AuthGate><ResultPage /></AuthGate>} />
      <Route path="*" element={<NotFound />} />
    </Routes></Suspense></PageErrorBoundary>
  </main>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
