import React, { Suspense, lazy, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Route, RouterProvider, Routes, createBrowserRouter, useLocation } from "react-router-dom";
import { MotionConfig } from "motion/react";
import "./v2/theme.css";
import { AuthProvider, AuthGate, LogoutPage, useAuth } from "./auth";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { CommandPalette } from "./v2/CommandPalette";
import { buildCommands } from "./v2/commands";
import { SessionsProvider, rehearsals, useSessions } from "./v2/sessions";
import { PageSkeleton, ToastHost } from "./v2/states";

// Every page loads on first use, so a visitor downloads only the page they open
// (the landing page's 3D, scroll and animation libraries stay out of the app pages).
const Landing = lazy(() => import("./pages/Landing"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewSession = lazy(() => import("./pages/NewSession"));
const SessionVideo = lazy(() => import("./pages/SessionVideo"));
const ResultPage = lazy(() => import("./pages/ResultPage"));
const Progress = lazy(() => import("./pages/Progress"));
const Compare = lazy(() => import("./pages/Compare"));
const Recap = lazy(() => import("./pages/Recap"));
const Settings = lazy(() => import("./pages/Settings"));
const Help = lazy(() => import("./pages/Help"));
const How = lazy(() => import("./pages/How"));
const About = lazy(() => import("./pages/About"));
const Privacy = lazy(() => import("./pages/Privacy"));
const StatusPage = lazy(() => import("./pages/Status"));

// A data router (one splat route around <Routes>) so pages can use useBlocker,
// e.g. to ask before leaving an unsent recording (useLeaveGuard.ts).
const router = createBrowserRouter([
  { path: "*", element: <AuthProvider><SessionsProvider><MotionConfig reducedMotion="user"><ToastHost><App /></ToastHost></MotionConfig></SessionsProvider></AuthProvider> },
]);

function App() {
  const { pathname } = useLocation();
  const { state } = useAuth();
  const { rows } = useSessions();
  const inside = !!state && (!!state.user || !state.required);
  const commands = useMemo(() => buildCommands(rehearsals(rows), !!state?.user), [rows, state?.user]);
  useFocusOnNavigate();
  const atEntry = pathname === "/";
  const landing = atEntry && state?.required === true && !state.user;
  useEffect(() => {
    const name = atEntry ? (landing ? "" : "หน้าหลัก") : pageName(pathname);
    document.title = name ? `${name} · PromptPre's` : "PromptPre's";
  }, [pathname, atEntry, landing]);

  return <div className="min-h-dvh overflow-x-clip bg-surface text-ink">
    <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-full bg-navy px-4 py-2.5 text-sm font-semibold text-white shadow-lift transition-transform focus:translate-y-0">ข้ามไปเนื้อหาหลัก</a>
    {inside && <CommandPalette commands={commands} />}
    <PageErrorBoundary pathname={pathname}>
      <Suspense fallback={atEntry && !state ? <div data-entry-pending className="min-h-dvh" /> : <PageSkeleton />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/logout" element={<LogoutPage />} />
          <Route path="/" element={!state ? <div data-entry-pending className="min-h-dvh" /> : landing ? <Landing /> : <AuthGate><Dashboard /></AuthGate>} />
          <Route path="/new" element={<AuthGate><NewSession /></AuthGate>} />
          <Route path="/sessions/:id/video" element={<AuthGate><SessionVideo /></AuthGate>} />
          <Route path="/sessions/:id" element={<AuthGate><ResultPage /></AuthGate>} />
          <Route path="/progress" element={<AuthGate><Progress /></AuthGate>} />
          <Route path="/compare" element={<AuthGate><Compare /></AuthGate>} />
          <Route path="/recap" element={<AuthGate><Recap /></AuthGate>} />
          <Route path="/settings" element={<AuthGate><Settings /></AuthGate>} />
          <Route path="/help" element={<Help />} />
          <Route path="/how" element={<How />} />
          <Route path="/about" element={<About />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<StatusPage />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  </div>;
}

/** The tab title for each page, so a screen reader announces where the visitor is and open tabs can be told apart. */
const PAGE_NAMES: Record<string, string> = {
  "/login": "เข้าสู่ระบบ", "/logout": "ออกจากระบบ", "/new": "ซ้อมรอบใหม่", "/progress": "ความคืบหน้า",
  "/compare": "เทียบ 2 รอบ", "/recap": "สรุปเดือน", "/settings": "ตั้งค่า", "/help": "ช่วยเหลือ",
  "/how": "เราวัดผลอย่างไร", "/about": "เกี่ยวกับ PromptPre's", "/privacy": "ความเป็นส่วนตัว",
};

function pageName(pathname: string): string {
  if (/^\/sessions\/[^/]+\/video\/?$/.test(pathname)) return "ส่งวิดีโอ";
  if (/^\/sessions\/[^/]+\/?$/.test(pathname)) return "ผลการซ้อม";
  return PAGE_NAMES[pathname.replace(/\/$/, "")] ?? "ไม่พบหน้านี้";
}

/** On a page change: move keyboard focus to the new page's main area (screen readers announce it) and scroll to
    the top, or to #id when the link has one. The target may appear late (lazy page, data), so keep looking for
    up to 2 seconds. */
function useFocusOnNavigate() {
  const { pathname, hash } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    const moved = previous.current !== pathname;
    previous.current = pathname;
    let tries = 0, id = 0;
    if (moved) {
      const focusMain = () => {
        const main = document.getElementById("main-content");
        if (main) main.focus({ preventScroll: true }); else if (++tries < 20) id = window.setTimeout(focusMain, 100);
      };
      focusMain();
    }
    if (!hash) { if (moved) window.scrollTo({ top: 0, behavior: "instant" }); return () => window.clearTimeout(id); }
    let look = 0, lid = 0;
    const find = () => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (++look < 20) lid = window.setTimeout(find, 100);
    };
    lid = window.setTimeout(find, 50);
    return () => { window.clearTimeout(id); window.clearTimeout(lid); };
  }, [pathname, hash]);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
