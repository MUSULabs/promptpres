# PromptPre's (พร้อมพรีต์)

ชื่อทางเทคนิค (โฟลเดอร์ แพ็กเกจ ตัวแปรสภาพแวดล้อม): `promptpres`

ระบบวิเคราะห์พฤติกรรมการนำเสนอด้วยเทคนิคการประมวลผลภาพและเสียง เพื่อการพัฒนาทักษะการนำเสนอ — Spec v2.4: 8 เกณฑ์ (C1 C2 S1 S2 S3 N1 N2 T1) ใน 4 Skill ผลแยกรายเกณฑ์ ไม่มีคะแนนรวม

**สถานะงานวิจัย N1/N2 (22 พ.ย. 2569, D-067 — OWNER_APPROVED / ADVISOR_APPROVED):** ล็อกขอบเขต (Scope Freeze v1.0) สำหรับออกแบบ N1/N2 ใหม่เป็นแบบจำลองจำแนกพฤติกรรมมือและทิศทางการมองเทียบแนวกล้อง — **ยังไม่ได้ implement** ระบบที่ทำงานอยู่ยังวัด N1/N2 แบบเดิม (Spec v2.4) · คู่มือติดป้าย โปรโตคอลการทดลอง และแบบฟอร์มผู้เชี่ยวชาญอยู่ใน [research/](research/README.md)

**สถานะ (15 พ.ย. 2569, D-050):** เพิ่มบัญชีผู้ใช้ + โหมดทดลองใช้, กราฟเรดาร์ 8 เกณฑ์, S3 เสียงเติมและคำติดปาก, Coach ที่รู้บริบทหัวข้อ และชุดติดตั้ง Cloud ([PILOT_RUNBOOK.md](PILOT_RUNBOOK.md) — ยังไม่ได้เปิดบริการจริง) · ครบ 8 เกณฑ์ + ชุดสถิติ `eval/` + โหมด Pilot ([PILOT.md](PILOT.md)) · ใช้งานผ่านเบราว์เซอร์ได้ครบวงจร — สร้างรอบซ้อม (เลือกแม่แบบการนำเสนอได้) → PDF → แก้/ยืนยันหัวข้อ → อัด/อัปโหลดวิดีโอ → คิว → worker วิเคราะห์ 8 เกณฑ์จริง → หน้าผล (AI Coach ที่ตรวจเวลากับหลักฐาน, แถบระดับ 4 ช่องพร้อมคำอธิบาย, แถบเวลาหลักฐาน, บทพูดที่กดแล้ววิดีโอเลื่อนไป) → ประวัติพร้อมตารางแนวโน้มผลการฝึกซ้อมข้ามรอบ · Result Contract 1.3

## รันในเครื่อง (Windows, ไม่ต้องใช้ Docker)

```bash
pip install -r api/requirements.txt -r worker/requirements.txt
cd web && npm ci && cd ..
python dev.py
```

เปิด http://localhost:5173 — `dev.py` เปิด 3 อย่างพร้อมกัน (Ctrl+C ปิดทั้งหมด):

| ส่วน | คำสั่งที่ dev.py รัน | หน้าที่ |
|---|---|---|
| API | `uvicorn api.app.main:app` (พอร์ต 8000, เอกสาร `/docs`) | รับไฟล์, ดึงหัวข้อจาก PDF, เก็บสถานะ, ส่งผล |
| web | `npm run dev` (พอร์ต 5173) | หน้าเว็บ |
| worker | `python -m worker.runner` | หยิบรอบซ้อมที่รอคิวมาวิเคราะห์ทีละรอบ (คลิป 1 นาที ≈ 2 นาทีบน GTX 1650) |

ต้องมี: FFmpeg, โมเดลใน `models/` (Whisper large-v3, MediaPipe face/hand/pose), และ `.env` ที่ตั้ง `OPENROUTER_API_KEY` กับ `OPENROUTER_MODEL` (ดู `.env.example`) — ถ้าไม่มี key ระบบยังวิเคราะห์ได้ 6 เกณฑ์ ส่วน C1 C2 จะ "วิเคราะห์ไม่ได้" พร้อมเหตุผล
`python dev.py --no-worker` = เปิดแค่ API + เว็บ (เครื่องที่ไม่มีโมเดล)

ข้อมูลอยู่ที่ (ไม่อยู่ใน git): ฐานข้อมูล `data/promptpres.db` (SQLite), ไฟล์ที่อัปโหลด `data/uploads/<session>/`, ผลวิเคราะห์ `data/runs/<session>/`

## รันบน Cloud: Vercel + Supabase + Modal (D-062) หรือ Docker Compose (D-050)

```bash
docker compose up --build -d     # API + หน้าเว็บที่ build แล้ว (127.0.0.1:8000), PostgreSQL, worker GPU
```

เริ่มจาก [คู่มือเปิด Cloud และ smoke test](DEPLOY_RUNBOOK.md) สำหรับบริการจริง: หน้าเว็บบน Vercel (`https://promptpres.vercel.app`), PostgreSQL บน Supabase, API บน Modal CPU และการวิเคราะห์บน Modal GPU T4 ที่เปิดเฉพาะเมื่อมีงาน (`deploy_modal.py`, `web/vercel.json`) หรือ Docker Compose บน VM เดียว (PostgreSQL + HTTPS reverse proxy) · ขั้นตอนสำรองและค่าใช้จ่าย: [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md)

## คิวงานทำงานอย่างไร

ตาราง `sessions` ในฐานข้อมูลเป็นทั้งข้อมูลรอบซ้อมและคิว (`promptpres_shared/store.py`): สถานะ `created → queued → processing → done | failed`
worker หยิบรอบที่รอนานที่สุดด้วยคำสั่ง UPDATE เดียว (สอง worker จะไม่ได้งานซ้ำกัน) เมื่อ worker เริ่มทำงานใหม่ รอบที่ค้าง `processing`
จาก worker ที่หยุดกลางคันจะกลับเข้าคิว ถ้าค้างซ้ำครบ `runner.max_attempts` ครั้ง (config) จะเป็น `failed` พร้อมเหตุผล คิวจึงไม่ค้าง

- สเปกและกติกา: [CLAUDE.md](CLAUDE.md) · worker: [worker/README.md](worker/README.md) · สถิติบทที่ 3–4 (IOC, ปรับเทียบ, ความแม่นยำ, ความสอดคล้อง, SUS): [eval/README.md](eval/README.md)
- Contract: [contracts/result.schema.json](contracts/result.schema.json), ตัวอย่าง [contracts/mocks/](contracts/mocks/)
- ทดสอบ: `cd api && python -m pytest -q` · `python -m pytest worker/tests -q` · `python -m pytest eval/tests -q` · `cd web && npx tsc -b --noEmit && npm run build`


## Pilot แบบเชิญ

อ่าน [คู่มือ Pilot](PILOT.md) ก่อนเปิดให้ผู้ทดลอง ใช้ข้อมูลสมมติทดสอบจากสองบัญชีและเปิด OpenRouter เฉพาะหลังตรวจคำชี้แจงกับเจ้าของโครงการ

## Checks

ติดตั้งชุดพัฒนาเพิ่มด้วย `python -m pip install -r requirements-dev.txt -r eval/requirements.txt`
แล้วรัน `python -m pytest api/tests worker/tests eval/tests` จากราก repository

ทดสอบเว็บด้วย Playwright: ติดตั้ง Python dependencies ของ API และ FFmpeg ก่อน แล้วรันจาก `web/`:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

ชุดทดสอบ build เว็บและเปิด API บน loopback ให้บริการเว็บที่ build แล้ว พร้อมฐาน SQLite และคลิปสังเคราะห์ในไดเรกทอรีชั่วคราว
ไม่ใช้ worker, ข้อมูลจริง หรือบริการ LLM หากจะใช้ Chrome ที่ติดตั้งอยู่ ให้ตั้ง `PROMPTPRES_TEST_BROWSER_CHANNEL=chrome`
ก่อนรัน สำหรับชุด Python ให้ตั้ง `PROMPTPRES_TEST_POSTGRES` เป็น URL ของ PostgreSQL สำหรับทดสอบโดยเฉพาะ
ถ้าไม่ได้ตั้ง เทสต์คิว PostgreSQL จะถูกข้ามและแสดงเหตุผลด้วย `pytest -rs`
