import { useState } from "react";
import { Icon } from "./ui";

const MOMENTS = [
  { time: "0:14", title: "เกริ่นที่มาของโครงงาน", detail: "“ทีมเราเริ่มจากปัญหาที่พบตอนซ้อมนำเสนอ…”", code: "C2" },
  { time: "1:02", title: "เว้นจังหวะก่อนเปลี่ยนหัวข้อ", detail: "ลองซ้อมประโยคเชื่อมเข้าหัวข้อถัดไป", code: "S2" },
];

/** An illustrated example of the evidence controls used in a finished rehearsal. */
export default function RehearsalPreview() {
  const [selected, select] = useState(1);
  const moment = MOMENTS[selected];
  return (
    <figure className="rehearsal-preview">
      <figcaption><Icon name="video" /> ตัวอย่างการย้อนดูรอบซ้อม</figcaption>
      <svg className="preview-art" viewBox="0 0 520 274" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="viewfinder-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M0 32V0h32" fill="none" stroke="#c4caf0" strokeWidth="1" />
          </pattern>
          <clipPath id="viewfinder-crop"><rect x="0" y="0" width="520" height="274" /></clipPath>
        </defs>
        <rect width="520" height="274" fill="#e5e8fa" />
        <rect width="520" height="274" fill="url(#viewfinder-grid)" />
        <g clipPath="url(#viewfinder-crop)">
          <circle cx="260" cy="158" r="111" fill="#d3d9f8" />
          <path d="M219 274v-14l-41 18-25-41 47-60c9-12 24-21 47-24h36c26 5 39 15 48 30l25 91" fill="#333c77" />
          <path d="M231 166c11 22 52 22 62-1l-17-9-1-28h-28l-3 29Z" fill="#aeb9ef" />
          <path d="M227 103c0-22 14-38 35-38 22 0 35 16 35 38l-4 23c-4 18-16 28-30 28s-27-13-31-29Z" fill="#bec8f6" />
          <path d="M228 118c-18-34 3-61 30-63 23-2 44 15 42 39l-5 20-7-18c-17 2-35-5-43-13-2 12-9 19-17 22Z" fill="#292f58" />
          <path d="M213 202v53m98-49 12 37M241 280l48-38" fill="none" stroke="#818cce" strokeWidth="2" strokeLinecap="round" />
          {selected === 0 ? <>
            <path d="m176 235-34-8-22-26 29-8 46 18" fill="#333c77" />
            <path d="M152 195c-9-3-18-9-22-16l-9-16c-3-5-6-4-6 2l4 17-13-8c-10-6-12 3-7 11l11 14c6 7 16 12 29 13Z" fill="#bec8f6" />
          </> : <>
            <path d="m150 237 31-7 56 18-10 26-57-4Z" fill="#424d90" />
            <path d="m227 249 24-8 19 3c8 3 7 8 1 8l-11 1 20 5c6 2 7 8-4 10l-26 4-24-3Z" fill="#bec8f6" />
          </>}
        </g>
        <g fill="none" stroke="#424d90" strokeWidth="2" strokeLinecap="round">
          <path d="M116 77V49h28m232 0h28v28m0 120v28h-28m-232 0h-28v-28" />
          <path d="M260 18v12m0 212v12M82 137h12m334 0h12" opacity=".65" />
        </g>
        <g stroke="#2823ef" fill="none" strokeWidth="1.5">
          <path d={selected === 0 ? "M130 178H68v-31" : "M254 251h100v-45"} />
          <circle cx={selected === 0 ? 130 : 254} cy={selected === 0 ? 178 : 251} r="4" fill="#fff" />
        </g>
      </svg>
      <div className="preview-cues" role="group" aria-label="จุดเวลาในตัวอย่าง">
        {MOMENTS.map(({ time, title }, index) => (
          <button key={time} type="button" aria-pressed={index === selected} aria-label={`${time} ${title}`}
            onClick={() => select(index)}><Icon name="play" /> {time}</button>
        ))}
      </div>
      <div className="preview-note" aria-live="polite">
        <span className="preview-code">{moment.code}</span>
        <div><strong>{moment.title}</strong><p>{moment.detail}</p></div>
      </div>
    </figure>
  );
}
