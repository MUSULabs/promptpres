import { Link } from "react-router-dom";
import whiteLogo from "../assets/brand/horizontal-white.svg";
import { Icon } from "../components/ui";
import "./landing.css";

const steps = [
  { icon: "video", title: "อัดหรืออัปโหลด", detail: "อัดผ่านกล้องบนเว็บ หรือส่งคลิปที่ซ้อมไว้แล้ว" },
  { icon: "play", title: "ย้อนดูผล", detail: "อ่านคำแนะนำหลังระบบวิเคราะห์ แล้วกดดูช่วงที่มีหลักฐาน" },
  { icon: "refresh", title: "ซ้อมอีกครั้ง", detail: "เลือกเรื่องที่อยากปรับ แล้วลองซ้อมใหม่" },
] as const;

export function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="landing-container landing-topbar">
        <Link className="landing-logo" to="/" aria-label="PromptPre’s หน้าแรก">
          <img src={whiteLogo} width="1504" height="246" alt="" />
        </Link>
        <nav aria-label="เมนูหน้าแรก">
          <a className="landing-link" href="#how-to-practice">วิธีใช้งาน</a>
          <Link className="landing-link landing-login" to="/login">เข้าสู่ระบบ</Link>
        </nav>
      </div>
    </header>
  );
}

export default function LandingPage() {
  return (
    <div className="landing-container">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <svg className="landing-emphasis" viewBox="0 0 63 41" aria-hidden="true" focusable="false">
            <path d="m5 30 14 6M19 13l12 14M41 5l4 17" fill="none"
              stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          </svg>
          <h1 id="landing-title">ซ้อมก่อน<br />พรีเซนต์จริง</h1>
          <p>อัดวิดีโอซ้อมนำเสนอผ่านเว็บ<br />แล้วดูผลและคำแนะนำสำหรับรอบต่อไป</p>
          <Link className="landing-start" to="/new">เริ่มซ้อม <Icon name="arrow" /></Link>
        </div>
        <div className="landing-mascot" aria-hidden="true" />
      </section>
      <section className="landing-how" id="how-to-practice" tabIndex={-1} aria-labelledby="landing-how-title">
        <h2 id="landing-how-title">วิธีใช้งาน</h2>
        <ol className="landing-steps">
          {steps.map(({ icon, title, detail }) => (
            <li key={icon}>
              <span className="landing-step-icon"><Icon name={icon} /></span>
              <div><h3>{title}</h3><p>{detail}</p></div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
