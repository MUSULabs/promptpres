import { Link } from "react-router-dom";
import guidingMascot from "../../design/mascot/ppre-guiding.svg?no-inline";
import { Icon } from "../components/ui";

const chapters = [
  { scene: "record", title: "อัด", detail: "เปิดกล้องแล้วซ้อมนำเสนอ หรืออัปโหลดคลิปที่อัดไว้แล้ว" },
  { scene: "review", title: "ย้อนดู", detail: "เมื่อวิเคราะห์เสร็จ อ่านคำแนะนำ แล้วกดดูช่วงที่มีหลักฐานในวิดีโอ" },
  { scene: "improve", title: "ปรับ", detail: "เลือกหนึ่งจุดจากคำแนะนำ เช่น ปรับจังหวะหยุดพูด แล้วลองใช้ในรอบถัดไป" },
  { scene: "repeat", title: "ซ้อมอีกครั้ง", detail: "นำสิ่งที่ปรับกลับมาลองพูด แล้วดูผลของรอบใหม่" },
] as const;

type Scene = typeof chapters[number]["scene"];

export default function LandingStory() {
  return (
    <section className="landing-how" id="how-to-practice" tabIndex={-1} aria-labelledby="landing-how-title">
      <div className="landing-container">
        <h2 id="landing-how-title">วิธีใช้งาน</h2>
        <div className="landing-story">
          <ol className="landing-chapters" role="list">
            {chapters.map(({ scene, title, detail }, index) => (
              <li key={scene} data-landing-chapter={scene} className="landing-chapter">
                <div className="landing-chapter-copy">
                  <span className="landing-chapter-number" aria-hidden="true">0{index + 1} / 04</span>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                  {scene === "repeat" && <Link className="landing-start" to="/new">เริ่มซ้อม <Icon name="arrow" /></Link>}
                </div>
                <div className="landing-story-inline" aria-hidden="true"><StoryArt scene={scene} /></div>
              </li>
            ))}
          </ol>
          <div className="landing-story-stage" data-chapter="record" aria-hidden="true">
            <div className="landing-story-panels">
              {chapters.map(({ scene }) => (
                <div key={scene} className="landing-story-panel" data-scene={scene}>
                  <StoryArt scene={scene} />
                </div>
              ))}
            </div>
            <div className="landing-story-track"><span /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StoryArt({ scene }: { scene: Scene }) {
  return (
    <div className={`landing-chapter-art landing-chapter-art-${scene}`}>
      <svg viewBox="0 0 480 336" aria-hidden="true" focusable="false">
        {scene === "record" && (
          <>
            <rect x="48" y="42" width="384" height="249" rx="18" fill="var(--pp-white)" stroke="var(--pp-blue)" strokeWidth="3" />
            <path d="M49 88h382" stroke="var(--pp-blue)" strokeWidth="3" />
            <circle cx="72" cy="65" r="5" fill="var(--landing-gold)" />
            <circle cx="91" cy="65" r="5" fill="var(--pp-blue)" />
            <rect x="69" y="108" width="342" height="162" rx="8" fill="var(--pp-blue)" />
            <path d="M93 143v-14h18m258 0h18v14m0 92v14h-18m-258 0H93v-14" fill="none" stroke="var(--pp-white)" strokeWidth="4" strokeLinecap="round" />
            <circle cx="240" cy="171" r="28" fill="var(--pp-white)" />
            <path d="M177 267v-20c8-25 30-39 63-39s55 14 63 39v20Z" fill="var(--pp-white)" />
            <circle cx="360" cy="152" r="10" fill="var(--landing-gold)" />
          </>
        )}
        {scene === "review" && (
          <>
            <rect x="42" y="46" width="396" height="242" rx="18" fill="var(--pp-white)" stroke="var(--pp-blue)" strokeWidth="3" />
            <rect x="64" y="68" width="352" height="130" rx="9" fill="var(--pp-blue)" />
            <path d="m227 107 37 26-37 26Z" fill="var(--pp-white)" />
            <path d="M81 234h318" stroke="var(--pp-line)" strokeWidth="8" strokeLinecap="round" />
            <path d="M81 234h157" stroke="var(--landing-gold)" strokeWidth="8" strokeLinecap="round" />
            <circle cx="238" cy="234" r="10" fill="var(--landing-gold)" stroke="var(--pp-blue)" strokeWidth="4" />
            <path d="M238 253v14m85-45v25" stroke="var(--pp-blue)" strokeWidth="3" strokeLinecap="round" />
          </>
        )}
        {scene === "improve" && (
          <>
            <path d="M256 57h143a19 19 0 0 1 19 19v105a19 19 0 0 1-19 19h-54l-26 23v-23h-63a19 19 0 0 1-19-19V76a19 19 0 0 1 19-19Z"
              fill="var(--pp-white)" stroke="var(--pp-blue)" strokeWidth="3" />
            <rect x="257" y="80" width="29" height="29" rx="6" fill="var(--landing-gold)" />
            <rect x="257" y="132" width="29" height="29" rx="6" fill="var(--pp-line)" />
            <path d="m263 94 6 6 11-13m-17 59 6 6 11-13" fill="none" stroke="var(--pp-blue)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M301 87h93m-93 52h93" stroke="var(--pp-muted)" strokeWidth="5" strokeLinecap="round" />
            <path d="M301 101h63m-63 52h63" stroke="var(--pp-line)" strokeWidth="5" strokeLinecap="round" />
            <ellipse cx="160" cy="283" rx="99" ry="11" fill="var(--pp-line)" />
            <rect x="129" y="160" width="46" height="58" rx="8" fill="var(--pp-white)" />
          </>
        )}
        {scene === "repeat" && (
          <>
            <circle cx="240" cy="168" r="106" fill="none" stroke="var(--pp-white)" strokeWidth="2" opacity=".38" />
            <path d="M310 153a72 72 0 1 0-16 62m16-62 6-36m-6 36-36-9" fill="none"
              stroke="var(--pp-white)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="294" cy="215" r="10" fill="var(--landing-gold)" />
            <path d="m348 99 17-11m-10 31 21-1" stroke="var(--landing-gold)" strokeWidth="7" strokeLinecap="round" />
          </>
        )}
      </svg>
      {scene === "improve" && <img src={guidingMascot} alt="" width="408" height="400" loading="lazy" decoding="async" />}
    </div>
  );
}
