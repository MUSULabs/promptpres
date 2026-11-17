import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./styles.css";
import { AuthProvider, AuthGate, AccountMenu } from "./auth";
import LoginPage from "./pages/LoginPage";
import Home from "./pages/Home";
import NewSession from "./pages/NewSession";
import SessionVideo from "./pages/SessionVideo";
import ResultPage from "./pages/ResultPage";
import { Brand, Icon, NotFound } from "./components/ui";

function App() {
  return (
    <BrowserRouter><AuthProvider>
      <a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a>
      <header className="topbar">
        <Brand />
        <nav aria-label="เมนูหลัก">
          <NavLink to="/" end><Icon name="history" /> ประวัติ</NavLink>
          <NavLink to="/new"><Icon name="plus" /> ซ้อมใหม่</NavLink>
        </nav><AccountMenu />
      </header>
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<AuthGate><Home /></AuthGate>} />
          <Route path="/new" element={<AuthGate><NewSession /></AuthGate>} />
          <Route path="/sessions/:id/video" element={<AuthGate><SessionVideo /></AuthGate>} />
          <Route path="/sessions/:id" element={<AuthGate><ResultPage /></AuthGate>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </AuthProvider></BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
