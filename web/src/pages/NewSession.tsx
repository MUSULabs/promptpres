import TopicEditor from "../components/TopicEditor";
import { useNewSession } from "../useNewSession";
import { Icon, Message, PageHeading, Steps } from "../components/ui";
import { TEMPLATES } from "../templates";

/** Step 1 of a practice: target time, PDF -> draft topics, edit and confirm (or skip C1/C2). */
export default function NewSession() {
  const { minutes, setMinutes, validTarget, session, topics, setTopics, draft, busy, error, problems, template,
    start, readPdf, addManualTopics, applyTemplate, goToVideo } = useNewSession();

  function skip() {
    if (window.confirm("ข้ามการยืนยันหัวข้อ? เกณฑ์เนื้อหา C1 และ C2 จะเป็น “วิเคราะห์ไม่ได้”")) {
      void goToVideo(null);
    }
  }

  return (
    <section>
      <Steps current={1} />
      <PageHeading badge="ขั้นตอนที่ 01" title="ตั้งค่ารอบซ้อม">
        ตั้งเวลาเป้าหมายและเรียงหัวข้อตามลำดับที่ตั้งใจจะพูด
      </PageHeading>
      <div className="panel">
        <h2><Icon name="clock" /> เวลาเป้าหมาย</h2>
        <div className="templates" role="group" aria-label="เลือกแม่แบบโครงสร้างการนำเสนอ">
          <p className="muted">เลือกแม่แบบโครงสร้างการนำเสนอ (ไม่บังคับ) — ตั้งเวลาและร่างหัวข้อให้ แล้วแก้ต่อได้</p>
          <div className="template-options">
            {TEMPLATES.map((t) => <button key={t.id} type="button" className="segment template-option"
              aria-pressed={template?.id === t.id} disabled={busy !== null} onClick={() => applyTemplate(t.id)}>
              <strong>{t.label}</strong>
              <span className="muted small">{t.minutes} นาที • {t.topics.length} หัวข้อ</span>
            </button>)}
          </div>
          {template?.note && <p className="muted small">{template.note}</p>}
        </div>
        <label>เวลาเป้าหมายในการนำเสนอ (นาที)
          <input type="number" min={1} max={60} step={0.5} value={minutes || ""} disabled={busy !== null}
            onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        {!validTarget && <Message kind="error">กรุณาตั้งเวลาเป้าหมาย 1–60 นาที</Message>}
        {!session && <button className="fit" disabled={busy !== null || !validTarget} onClick={start}>
          {busy === "start" ? "กำลังสร้าง…" : "เริ่ม"} <Icon name="arrow" />
        </button>}
      </div>

      {session && (
        <div className="panel">
          <h2><Icon name="document" /> หัวข้อที่จะนำเสนอ</h2>
          <p className="muted">หัวข้อที่ยืนยันจะใช้วิเคราะห์เกณฑ์เนื้อหา C1–C2</p>
          {session.pdf_enabled && <label className="file-field file-picker">
            <span className="button secondary"><Icon name="document" /> เลือก PDF รายงานหรือสไลด์โครงงาน</span>
            <span className="muted">ระบบเสนอรายการหัวข้อให้แก้ไขก่อนยืนยัน</span>
            <input className="sr-only" type="file" accept="application/pdf" disabled={busy !== null}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void readPdf(file);
              }} />
          </label>}
          {draft && <div className="selected-file"><Icon name="document" /><strong>{draft.pdfName}</strong></div>}
          {busy === "pdf" && <Message>กำลังสกัดหัวข้อจาก PDF…</Message>}
          {!topics && (
            <div className="row">
              <button className="ghost" disabled={busy !== null} onClick={addManualTopics}>
                เพิ่มหัวข้อเอง
              </button>
              <button className="ghost" disabled={busy !== null || !validTarget} onClick={skip}>ข้ามขั้นนี้</button>
            </div>
          )}
          {topics && (
            <>
              <p className="muted">
                {draft ? "ร่างจาก PDF โดยแบบจำลองภาษา — ตรวจและแก้ให้ตรงกับที่จะพูดจริง"
                  : template ? `ร่างจากแม่แบบ “${template.label}” — แก้ให้ตรงกับที่จะพูดจริง` : "พิมพ์หัวข้อตามลำดับที่ตั้งใจจะพูด"}
                {" "}เรียงลำดับด้วยปุ่ม ↑ ↓ (ลำดับนี้ใช้ตรวจเกณฑ์ C1)
              </p>
              {draft?.note && <Message>{draft.note}</Message>}
              <fieldset disabled={busy !== null} className="editor-fields">
                <legend className="sr-only">แก้ไขหัวข้อที่จะนำเสนอ</legend>
                <TopicEditor topics={topics} limits={session.topic_limits} onChange={setTopics} />
              </fieldset>
              {problems.length > 0 && <p className="error">{problems.join(" · ")}</p>}
              <div className="row">
                <button disabled={busy !== null || !validTarget || problems.length > 0} onClick={() => goToVideo(topics)}>
                  {busy === "confirm" ? "กำลังบันทึก…" : "ยืนยันหัวข้อ แล้วไปขั้นวิดีโอ"}
                  <Icon name="arrow" />
                </button>
                <button className="ghost" disabled={busy !== null || !validTarget} onClick={skip}>ข้ามขั้นนี้</button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <Message kind="error">{error}</Message>}
    </section>
  );
}
