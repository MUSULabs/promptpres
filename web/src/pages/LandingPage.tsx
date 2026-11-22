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
        <RehearsalIllustration />
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

function RehearsalIllustration() {
  return (
    <svg className="landing-art" viewBox="0 0 558 390" aria-hidden="true" focusable="false">
      <g transform="rotate(-7 243 200)">
        <rect x="24" y="64" width="438" height="264" rx="21" fill="var(--pp-white)" />
        <rect x="30" y="70" width="426" height="252" rx="15" fill="none" stroke="var(--pp-ink)" strokeWidth="2" />
        <g fill="var(--pp-blue)">
          <circle cx="51" cy="88" r="3.8" /><circle cx="65" cy="88" r="3.8" /><circle cx="79" cy="88" r="3.8" />
        </g>
        <path d="M30 103h426" stroke="var(--pp-ink)" strokeWidth="2" />
        <rect x="48" y="119" width="390" height="156" rx="7" fill="var(--pp-surface)" />
        <path d="M94 153v-14h17m264 0h17v14m0 89v14h-17m-264 0H94v-14" fill="none"
          stroke="var(--pp-blue)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M158 275c3-25 14-39 37-46l32-10h32l31 10c22 7 35 24 38 46Z" fill="var(--pp-ink)" />
        <path d="M226 209h33v17c-4 12-29 12-34 0Z" fill="var(--pp-line)" />
        <path d="M212 179c0-21 14-35 31-35 19 0 32 15 32 35v14c0 19-15 32-32 32s-31-13-31-32Z"
          fill="var(--pp-line)" />
        <path d="M211 190c-11-25 5-51 32-51 22 0 38 16 34 43l-5 4-5-15c-9 4-20 1-28-5-4 8-14 14-23 15l-2 10Z"
          fill="var(--pp-ink)" />
        <path d="M222 274v-8l-19-9-23 14m90 3v-10l21-10 23 14" fill="none"
          stroke="var(--pp-white)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M52 302h382" fill="none" stroke="var(--pp-line)" strokeWidth="7" strokeLinecap="round" />
        <path d="M52 302h129" stroke="var(--pp-gold)" strokeWidth="7" strokeLinecap="round" />
        <circle cx="181" cy="302" r="6" fill="var(--pp-white)" stroke="var(--pp-blue)" strokeWidth="3" />
      </g>
      <g transform="rotate(8 445 109)">
        <path d="M367 47h143c10 0 17 7 17 17v92c0 10-7 17-17 17h-78l-29 22v-22h-36c-10 0-17-7-17-17V64c0-10 7-17 17-17Z"
          fill="var(--pp-white)" stroke="var(--pp-ink)" strokeWidth="3" strokeLinejoin="round" />
        <path d="M381 79h17v17h-17zM381 121h17v17h-17z" fill="var(--pp-gold)" stroke="var(--pp-gold)"
          strokeWidth="6" strokeLinejoin="round" />
        <path d="m382 87 5 5 9-11m-14 48 5 5 9-11" fill="none" stroke="var(--pp-ink)"
          strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M415 83h74m-74 42h74" stroke="var(--pp-ink)" strokeWidth="4" strokeLinecap="round" />
        <path d="M415 94h50m-50 42h50" stroke="var(--pp-line)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <path d="m469 244 16-3m-13 19 22 8m-33 3 9 15" fill="none" stroke="var(--pp-gold)"
        strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
