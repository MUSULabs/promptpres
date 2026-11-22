import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import "./brand.css";
import "./styles.css";
import { AuthProvider, AuthGate, AccountMenu, useAuth } from "./auth";
import LoginPage from "./pages/LoginPage";
import LandingPage, { LandingHeader } from "./pages/LandingPage";
import Home from "./pages/Home";
import NewSession from "./pages/NewSession";
import SessionVideo from "./pages/SessionVideo";
import ResultPage from "./pages/ResultPage";
import { Brand, Icon, NotFound } from "./components/ui";

function App() {
  return (
    <BrowserRouter><AuthProvider><AppShell /></AuthProvider></BrowserRouter>
  );
}

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
  return <header className="site-header">
    <div className="topbar">
      <Brand />
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
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  return <main id="main-content" className={landing ? "landing-main" : undefined} tabIndex={-1} ref={main}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={landing ? <LandingPage /> : <AuthGate><Home /></AuthGate>} />
      <Route path="/new" element={<AuthGate><NewSession /></AuthGate>} />
      <Route path="/sessions/:id/video" element={<AuthGate><SessionVideo /></AuthGate>} />
      <Route path="/sessions/:id" element={<AuthGate><ResultPage /></AuthGate>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </main>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
