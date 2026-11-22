# PromptPre's Cloud Pilot Runbook — D-050, D-062

## ก่อนเปิดบริการ

ระบบ Cloud Web Application มี React/FastAPI, บัญชีผู้ใช้, SQLite หรือ PostgreSQL และ worker GPU ที่วิเคราะห์หลังอัปโหลดเสร็จ บริการจริงต้องมี HTTPS เพื่ออัดกล้องผ่านเบราว์เซอร์ โค้ดนี้เตรียมติดตั้งสองทาง; ผลทดสอบในเครื่องไม่แทนการตรวจบริการ Cloud จริง

ตั้ง `PROMPTPRES_SESSION_SECRET` เป็นค่าลับสุ่มอย่างน้อย 32 ตัวอักษรและคงค่าเดิมข้าม restart, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL=google/gemini-2.5-flash-lite` และ `PROMPTPRES_PUBLIC_ORIGIN=https://<host>` ห้าม commit `.env` หรือ keys ถ้าไม่มี OpenRouter จะไม่มีผล C1/C2 และ Coach; เกณฑ์อื่นยังทำงานแยกกัน

เมื่อ `PROMPTPRES_REQUIRE_LOGIN=1` ต้องตั้ง `PROMPTPRES_PUBLIC_ORIGIN` เสมอ (API จะไม่ยอมเริ่มรับคำขอถ้าไม่ตั้ง) เพราะหลัง proxy ที่ทำ HTTPS แอปมองเห็นคำขอเป็น `http://` และจะปฏิเสธการบันทึกทุกครั้ง คุกกี้ล็อกอินตั้ง `Secure` เมื่อ origin เป็น `https://` การจำกัดจำนวนครั้งล็อกอิน 60 ครั้ง/นาทีนับแยกตาม IP ผู้ใช้: Compose ตั้ง `PROMPTPRES_TRUSTED_PROXY=1` (อ่านรายการสุดท้ายของ `X-Forwarded-For` จาก proxy ของตัวเอง) ส่วน Modal ตั้ง `PROMPTPRES_TRUSTED_PROXY=vercel` (อ่าน `x-real-ip` ที่ Vercel ใส่ให้) ห้ามตั้งค่านี้ถ้า API รับคำขอจากอินเทอร์เน็ตโดยตรงโดยไม่มี proxy นั้น `PROMPTPRES_PUBLIC_ORIGIN` ใส่ได้หลายที่อยู่คั่นด้วยจุลภาค รายการแรกเป็นที่อยู่หลัก

`PROMPTPRES_REQUIRE_LOGIN=1` เปิดการบังคับบัญชี มี Register/Login/Guest และ logout เพิกถอนเซสชัน Guest แยกตามเบราว์เซอร์ คุกกี้มีอายุ 24 ชั่วโมง สมาชิก 7 วัน สมัครจาก Guest ย้ายประวัติในธุรกรรมเดียว; login บัญชีเดิมไม่รวมประวัติ Guest ควรสมัครก่อนคุกกี้ Guest หมดอายุ ไม่มี password reset/email verification ในรุ่นนี้

## Docker Compose บน Cloud GPU

ต้องมี NVIDIA driver, Docker Engine + Compose และ NVIDIA Container Toolkit ตั้งค่าข้างต้นและ `POSTGRES_PASSWORD` ใน `.env` (ใช้รหัสผ่าน URL-safe เพราะนำเข้ารูปแบบ DATABASE_URL) จาก repo root:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose logs -f worker
```

หยุดบริการ (ข้อมูลใน volume ยังอยู่): `docker compose down` — ห้ามใส่ `-v` เพราะจะลบฐานข้อมูล ไฟล์รอบซ้อม และโมเดล

หมายเหตุ: ทุก image ใช้ Python 3.12 เหมือน CI และ Modal (worker ติดตั้งผ่าน uv บน image CUDA) — build ทั้งสอง image บนเครื่องพัฒนาผ่านแล้ว (16 พ.ย. 2569) แต่ยังไม่ได้รันจริงบนเครื่อง Cloud ที่มี GPU ให้ตรวจ `docker compose logs worker` รอบแรกจนเห็น `waiting for work`

API เปิดเฉพาะ `127.0.0.1:8000` ใช้ reverse proxy ที่เครื่อง Cloud เสิร์ฟ HTTPS เช่น Caddy:

```caddyfile
promptpres.example.org {
    reverse_proxy 127.0.0.1:8000
}
```

เปลี่ยน hostname เป็นของจริง ให้ `PROMPTPRES_PUBLIC_ORIGIN` ตรงกัน เปิดอินเทอร์เน็ตเฉพาะ 80/443 และคง PostgreSQL ภายใน Compose หน้าเว็บ build ใน Dockerfile แล้ว ไม่ต้องรัน Vite บนบริการจริง Worker ดาวน์โหลดโมเดลทางการครั้งแรกลง volume `models`; ตรวจ log จนเริ่มรอคิวก่อนทดลอง

## Vercel + Supabase + Modal (D-062)

ขั้นตอนติดตั้งทีละคำสั่งอยู่ใน `DEPLOY_RUNBOOK.md` หัวข้อ ก. ภาพรวม:

- **หน้าเว็บ:** Vercel Hobby (`https://promptpres.app`; เดิม `promptpres.vercel.app` ยังใช้ได้) เสิร์ฟ `web/dist` และ rewrite `/api/*` ไป Modal (`web/vercel.json`) คุกกี้ล็อกอินจึงอยู่ใน origin เดียวกับหน้าเว็บ Vercel Hobby ใช้ได้เฉพาะงานที่ไม่ใช่เชิงพาณิชย์ ซึ่งตรงกับโครงงานนี้
- **ฐานข้อมูล:** Supabase PostgreSQL (Free, `us-east-1`) ผ่าน Session Pooler พอร์ต 5432 (`pool_size=3`) migration v4 เปิด RLS ทุกตาราง และปิด Data API ไว้ จึงเข้าถึงได้เฉพาะผ่านแอป
- **API (CPU):** ฟังก์ชัน `web` บน Modal ภูมิภาค us-east (ใกล้ Supabase) CPU 1 ตัว หน่วยความจำ 1 GB `max_containers=1` รับพร้อมกัน 32 คำขอ ปิดเองหลังว่าง 5 นาที
- **วิเคราะห์ (GPU):** `Analyser` บน T4 เปิดเมื่อมีงาน (สูงสุด 4 ตัวพร้อมกัน) ปิดเองหลังว่าง 60 วินาที โมเดลอยู่ใน Volume `promptpres-models` ที่เตรียมครั้งเดียวด้วย `modal run deploy_modal.py::download_models` หาก GPU ถูกเรียกคืนกลางงาน exit handler คืนรอบนั้นเข้าคิว
- **ไฟล์:** Volume `promptpres-media` เก็บเฉพาะ `runs/<id>/playback.mp4` (≤480p) กับ JSON ขนาดเล็ก ไฟล์ดิบและไฟล์กลางถูกลบหลังวิเคราะห์ งาน `maintain` ทุก 15 นาทีลบวิดีโอ Guest อายุเกิน 7 วัน สมาชิก 30 วัน และไฟล์ดิบที่วิเคราะห์ไม่สำเร็จเกิน 1 วัน (`config/storage-v0.yaml`) คะแนนและข้อเสนอแนะเก็บถาวร

**เวลา:** Modal จำกัดคำขอ HTTP แต่ละครั้งที่ 150 วินาที และ Vercel รอการตอบไม่เกิน 120 วินาทีและรับ body ขนาดจำกัด เบราว์เซอร์จึงส่งวิดีโอและ PDF เป็นชิ้นละ 8 MB ตรงไปที่ Modal (ใช้ตั๋วอัปโหลดที่ลงนามแล้วใน header `X-Upload-Token` ลองซ้ำชิ้นละ 3 ครั้ง) ไฟล์สูงสุด 512 MB เครื่องเล่นวิดีโอใช้ลิงก์ลงนามอายุ 12 ชั่วโมงตรงไปที่ Modal การวิเคราะห์ทำในคิวพื้นหลัง ไม่ผูกอายุ HTTP request

**ค่าใช้จ่าย:** GPU คิดเงินเฉพาะช่วงที่เปิดอยู่ ราคา T4 บนหน้า modal.com/pricing (ตรวจ 15 พ.ย. 2569) คือ 0.000164 USD/วินาที ≈ 0.59 USD/ชั่วโมง ยังไม่รวม CPU และหน่วยความจำ Modal ให้เครดิต 30 USD ต่อเดือน ตั้งงบในบัญชี Modal และหยุดทุกอย่างด้วย `modal app stop promptpres` เมื่อเลิกใช้

**อัปเดตบริการ:** `modal deploy deploy_modal.py` ทับได้โดยไม่ต้องหยุด เพราะฐานข้อมูลอยู่ภายนอกและคิวรับหลาย worker ได้ (`claim` แบบ atomic) รอบที่ถูกขัดจังหวะถูกคืนเข้าคิวตาม `runner.max_attempts` ใน `config/pipeline-v0.yaml`

## ตรวจรับก่อน SUS

1. เปิด `/login` ผ่าน HTTPS สมัครสมาชิก → สร้างรอบ → ยืนยันหัวข้อ → อัด/อัปโหลดคลิปสังเคราะห์ → รอผลครบ ตรวจระดับ กราฟ หลักฐาน บทพูด และ Coach
2. เปิด browser อีกตัว: บัญชีอื่นต้องไม่เห็นรอบ/วิดีโอเดิม; บัญชีเดิมต้องเห็นประวัติเดิม
3. ทดลอง Guest → สร้างรอบ → สมัครสมาชิก: session ID เดิมยังอยู่ ล็อกอินอีกเครื่องเห็นรอบนั้น
4. ทดสอบ restart ขณะคิวว่าง ตรวจบัญชี รอบ ผล และวิดีโอยังอยู่ ถ้าคิวค้างดู `runner_error.txt` และ log worker ห้ามนำไฟล์ errors ที่มีข้อมูลผู้ใช้เผยแพร่
5. ตรวจ `/api/health`, เปิด deep link `/sessions/<id>`, ตรวจกล้องจริง desktop/mobile และอัปโหลดคลิปตามขนาดที่ใช้ SUS บันทึกวัน รุ่น และผลจริงใน LOG

## ตรวจคิวงาน

คิวคือคอลัมน์ `status` ของตาราง `sessions` (`created` → `queued` → `processing` → `done`/`failed`) worker หยิบทีละรอบ

```sh
# Compose (PostgreSQL)
docker compose exec db psql -U promptpres -c "SELECT status, count(*) FROM sessions GROUP BY status;"
docker compose exec db psql -U promptpres -c "SELECT session_id, status, attempts, created_at FROM sessions WHERE status IN ('queued','processing') ORDER BY created_at;"
docker compose logs --tail 50 worker

# Modal + Supabase — log ของ API, worker และงาน maintain
modal app logs promptpres
```

บน Supabase ดูตารางได้จาก SQL Editor ใน dashboard (คำสั่ง SELECT เดียวกับด้านบน) งาน `maintain` ทุก 15 นาทีคืนรอบที่ค้าง `processing` นานเกินกำหนดเข้าคิว ส่งงานที่ค้าง `queued` ให้ GPU อีกครั้ง และเปลี่ยนรอบที่เกิน `runner.max_attempts` ใน `config/pipeline-v0.yaml` เป็น `failed`

## สำรอง กู้คืน และลบข้อมูล

Compose: หยุดรับงานและรอ worker ว่าง สำรองฐาน PostgreSQL และ volume `sessions` คู่กัน เก็บ `models` แยกได้; ทดลองกู้คืนเข้าบริการทดสอบก่อนใช้จริง

```sh
# สำรอง
docker compose stop api worker
docker compose exec -T db pg_dump -U promptpres promptpres > backup.sql
docker run --rm -v promptpres_sessions:/data -v "$PWD":/backup alpine tar czf /backup/sessions.tgz -C /data .
# กู้คืน (ฐานข้อมูลว่าง)
docker compose exec -T db psql -U promptpres promptpres < backup.sql
docker run --rm -v promptpres_sessions:/data -v "$PWD":/backup alpine tar xzf /backup/sessions.tgz -C /data
docker compose up -d
```

ชื่อ volume ขึ้นกับชื่อโฟลเดอร์โปรเจกต์ ตรวจด้วย `docker volume ls` ก่อน

Supabase: Free tier ไม่มี backup อัตโนมัติ ใช้ `pg_dump` ผ่าน Docker ตามคำสั่งใน `DEPLOY_RUNBOOK.md` (ส่ง URL ผ่าน environment ไม่พิมพ์ออกจอ) ไฟล์วิดีโอใน Volume ดาวน์โหลดได้ด้วย `modal volume get promptpres-media runs/<id> <backup-dir>` เก็บข้อมูลส่วนตัวในไดรฟ์จำกัดสิทธิ์

การขอลบ: ผู้ดูแลยืนยันบัญชีและรายการ session IDs ก่อน หยุด worker ให้ไม่มีงานของบัญชีนั้น ลบแถว topics_versions/results/sessions และไฟล์ uploads/runs เฉพาะ IDs ที่ยืนยัน ใช้ธุรกรรมฐานข้อมูลและสำรองก่อนดำเนินการ ตัวอย่างสำหรับ PostgreSQL (แทน `<id>` ด้วย session ID ที่ยืนยันแล้ว ทำทีละรอบ):

```sql
BEGIN;
DELETE FROM results WHERE session_id = '<id>';
DELETE FROM topics_versions WHERE session_id = '<id>';
DELETE FROM sessions WHERE session_id = '<id>';
COMMIT;
```

จากนั้นลบไฟล์ของรอบนั้น: Compose ลบโฟลเดอร์ `/data/uploads/<id>` และ `/data/runs/<id>` ใน volume `sessions`; Modal ใช้ `modal volume rm -r promptpres-media runs/<id>` การลบบัญชีต้องลบ auth_sessions ก่อน users บน Modal วิดีโอถูกลบอัตโนมัติ (Guest 7 วัน สมาชิก 30 วัน) แต่คะแนนและข้อเสนอแนะเก็บถาวร ต้องแจ้งระยะเก็บข้อมูลและผู้ติดต่อในคำชี้แจง SUS ก่อนใช้ข้อมูลจริง

Tailscale Pilot เดิมยังใช้ตาม `PILOT.md` เป็นอีกโหมด ไม่ใช้ร่วมกับฐานข้อมูล Cloud โดยอัตโนมัติ GTX 1650 4GB เป็นเครื่องพัฒนาและฐานเปรียบเทียบประสิทธิภาพ ไม่จำเป็นต้องเปิดไว้เมื่อใช้ Cloud
