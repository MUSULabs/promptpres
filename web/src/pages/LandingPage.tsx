import { Link } from "react-router-dom";
import ppreDefault from "../../design/mascot/ppre-default.svg?no-inline";
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
    <svg className="landing-art" viewBox="0 0 558 400" aria-hidden="true" focusable="false">
      <defs>
        {/* Give the approved blue asset a white edge only inside this scene. */}
        <filter id="landing-mascot-edge" x="-5%" y="-5%" width="110%" height="110%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="edge" />
          <feFlood floodColor="var(--pp-white)" result="white" />
          <feComposite in="white" in2="edge" operator="in" result="backing" />
          <feMerge><feMergeNode in="backing" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g transform="rotate(-7 227 177)">
        <rect x="22" y="65" width="429" height="240" rx="21" fill="var(--pp-white)" />
        <path d="M28 108V86a15 15 0 0 1 15-15h387a15 15 0 0 1 15 15v22Z" fill="var(--pp-blue)" />
        <g fill="var(--pp-white)">
          <circle cx="49" cy="89" r="4.5" /><circle cx="65" cy="89" r="4.5" /><circle cx="81" cy="89" r="4.5" />
        </g>
        <rect x="43" y="120" width="387" height="142" rx="8" fill="var(--pp-line)" />
        <path d="M69 147v-11h12m309 0h12v11m0 85v11h-12m-309 0H69v-11" fill="none"
          stroke="var(--pp-white)" strokeWidth="3" strokeLinecap="round" />
        <path d="M136 262c6-22 17-34 37-40l26-8h30l27 8c21 6 32 20 36 40Z" fill="var(--pp-ink)" />
        <path d="M201 203h26v16c-5 10-21 10-27 0Z" fill="var(--pp-white)" />
        <path d="M186 179c0-17 11-28 28-28 16 0 27 12 27 28v12c0 16-12 27-27 27s-28-11-28-27Z" fill="var(--pp-white)" />
        <path d="M186 193c-11-23 3-47 28-47 21 0 34 16 29 37l-3 5-5-13c-10 4-21 1-29-5-4 8-10 13-16 14l-1 9Z"
          fill="var(--pp-ink)" />
        <path d="M162 262l17-13 16 8m39 5 15-13 17 10" fill="none"
          stroke="var(--pp-white)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M48 282h376" stroke="var(--pp-line)" strokeWidth="8" strokeLinecap="round" />
        <path d="M48 282h104" stroke="var(--landing-gold)" strokeWidth="8" strokeLinecap="round" />
        <circle cx="152" cy="282" r="6.5" fill="var(--landing-gold)" stroke="var(--pp-blue)" strokeWidth="3" />
      </g>
      <g transform="rotate(7 436 89)">
        <path d="M364 24h148a16 16 0 0 1 16 16v90a16 16 0 0 1-16 16h-37l-23 19v-19h-88a16 16 0 0 1-16-16V40a16 16 0 0 1 16-16Z"
          fill="var(--pp-white)" stroke="var(--pp-blue)" strokeWidth="3" strokeLinejoin="round" />
        <g fill="var(--landing-gold)">
          <rect x="367" y="44" width="30" height="30" rx="6" />
          <rect x="367" y="92" width="30" height="30" rx="6" />
        </g>
        <path d="m374 58 5 6 11-13m-16 55 5 6 11-13" fill="none"
          stroke="var(--pp-blue)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M413 52h93m-93 48h93" stroke="var(--pp-muted)" strokeWidth="5" strokeLinecap="round" />
        <path d="M413 66h65m-65 48h65" stroke="var(--pp-line)" strokeWidth="5" strokeLinecap="round" />
      </g>
      <ellipse cx="356" cy="383" rx="118" ry="13" fill="var(--pp-line)" />
      <g transform="translate(224 130) scale(.66)">
        <rect x="149" y="125" width="99" height="115" rx="20" fill="var(--pp-white)" />
        <image href={ppreDefault} width="408" height="400" filter="url(#landing-mascot-edge)" />
      </g>
      <path d="m479 219 7-17m6 29 19-10m-13 24 18 1" fill="none"
        stroke="var(--landing-gold)" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
