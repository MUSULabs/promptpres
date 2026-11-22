import { useId, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import horizontalBrand from "../assets/brand/horizontal.svg";

const ICONS = {
  alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  camera: <><path d="M14.5 7 16 5H8L6.5 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-5.5Z" /><circle cx="12" cy="13" r="3.5" /></>,
  check: <path d="m5 12 4 4L19 7" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  document: <><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  microphone: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></>,
  play: <path d="m8 5 11 7-11 7V5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M5 20h14" /></>,
  user: <><circle cx="12" cy="8" r="3" /><path d="M5 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

export function Brand({ label = "PromptPre's — ประวัติการซ้อม" }: { label?: string }) {
  return (
    <Link className="brand" to="/" aria-label={label}>
      <img src={horizontalBrand} width="1504" height="246" alt="PromptPre's" />
    </Link>
  );
}

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["ตั้งค่ารอบซ้อม", "เตรียมวิดีโอ", "ผลการวิเคราะห์"];
  return (
    <ol className="steps" aria-label="ขั้นตอนการซ้อม">
      {steps.map((label, i) => (
        <li key={label} aria-current={i + 1 === current ? "step" : undefined} data-complete={i + 1 < current}>
          <span className="step-index" aria-hidden="true">{i + 1 < current ? <Icon name="check" /> : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

export function PageHeading({ title, children, action }: {
  title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        {children && <p className="page-description">{children}</p>}
      </div>
      {action}
    </header>
  );
}

export function Message({ kind = "info", children }: { kind?: "error" | "info"; children: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon name={kind === "error" ? "alert" : "clock"} /><div>{children}</div>
    </div>
  );
}

export function ConfirmDialog({ dialogRef, title, description, confirmLabel, onConfirm, onClose }: {
  dialogRef: RefObject<HTMLDialogElement>;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose?: () => void;
}) {
  const id = useId();
  return <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-description`} onClose={onClose}>
    <span className="state-icon"><Icon name="alert" /></span>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    <div className="row">
      <button className="ghost" type="button" autoFocus onClick={() => dialogRef.current?.close()}>ยกเลิก</button>
      <button className="danger" type="button" onClick={() => {
        dialogRef.current?.close();
        onConfirm();
      }}>{confirmLabel}</button>
    </div>
  </dialog>;
}

export function NotFound({ message = "ไม่พบหน้าที่คุณต้องการ" }: { message?: string }) {
  return (
    <section className="panel empty-state">
      <span className="state-icon"><Icon name="alert" /></span>
      <h1>{message}</h1>
      <Link className="button secondary" to="/"><Icon name="history" /> กลับหน้าประวัติ</Link>
    </section>
  );
}
