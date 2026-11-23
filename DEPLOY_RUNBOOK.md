# เปิดบริการ PromptPre's บน Cloud

เริ่มจากโฟลเดอร์ repo ที่รุ่นสำหรับประเมิน ใช้คีย์ OpenRouter ที่จำกัดงบไว้ (โมเดล `google/gemini-2.5-flash-lite`) เก็บ signing secret เดิมข้าม restart และทดสอบด้วยข้อมูลซ้อมที่อนุญาตก่อนเปิดรับผู้ใช้

### ก. Vercel + Supabase + Modal (D-062) — PowerShell 7

สถาปัตยกรรม: หน้าเว็บอยู่บน Vercel (`https://promptpres.app` ส่งต่อไป `https://www.promptpres.app`; ที่อยู่เดิม `https://promptpres.vercel.app` ยังใช้ได้, rewrite `/api/*` ไป Modal) ฐานข้อมูล Supabase PostgreSQL ภูมิภาค `us-east-1` ผ่าน Session Pooler พอร์ต 5432 และ Modal สองชั้น: `web` (CPU 1 ตัว, us-east, scale to zero) รับคำขอ API ชิ้นอัปโหลด 8 MB และเสิร์ฟวิดีโอ ส่วน `Analyser` (GPU T4) เปิดเฉพาะเมื่อมีงานวิเคราะห์แล้วปิดเองหลังว่าง 60 วินาที ไฟล์เก็บใน Modal Volume v2 สองชุด: `promptpres-models` (น้ำหนักโมเดล) และ `promptpres-media` (เฉพาะ `playback.mp4` ≤480p กับไฟล์ JSON ขนาดเล็กของแต่ละรอบ) ชั้น CPU ไม่ mount `promptpres-media` และไม่เรียก `volume.reload()` แต่อ่าน/เขียนผ่าน API ของ Volume

`.env` ในโฟลเดอร์ repo ต้องมี `DATABASE_URL` (Supabase Session Pooler, `?sslmode=require`) `PROMPTPRES_SESSION_SECRET` และ `OPENROUTER_API_KEY` สคริปต์ secret อ่านค่าจากไฟล์โดยตรงและไม่พิมพ์ค่าใด ๆ ออกจอ

```powershell
python -m pip install modal
modal setup
modal volume create promptpres-models --version 2
modal volume create promptpres-media --version 2
& ./tools/set_modal_secret.ps1 -Origin "https://www.promptpres.app,https://promptpres.app,https://promptpres.vercel.app" -Replace
$env:PYTHONUTF8 = '1'
modal deploy deploy_modal.py
modal run deploy_modal.py::download_models
```

นำ URL ของฟังก์ชัน `web` จากผล `modal deploy` (รูป `https://<workspace>--promptpres-web.us-east.modal.run`) ไปใส่ใน `web/vercel.json` (rewrite `/api/:path*`) และตั้งเป็น direct origin แล้ว deploy ใหม่:

```powershell
$PT_DIRECT = (Read-Host 'Modal web URL').TrimEnd('/')
& ./tools/set_modal_secret.ps1 -Origin "https://www.promptpres.app,https://promptpres.app,https://promptpres.vercel.app" -DirectOrigin $PT_DIRECT -Replace
modal deploy deploy_modal.py
Push-Location web
npm ci
vercel link --yes --project promptpres
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
Pop-Location
python deploy_smoke.py https://www.promptpres.app --direct $PT_DIRECT
```

**23 พ.ย. 2569: repo เปิดเป็นสาธารณะแล้ว → Vercel deploy จาก GitHub เองอีกครั้ง** (push ขึ้น `main` = deploy Production; `60f08c9` deploy ผ่าน Git สำเร็จ) · ไม่ต้องรันสคริปต์ด้านล่างตามปกติ เก็บไว้ใช้เมื่อ Git deployment ใช้ไม่ได้ · ก่อน commit ทุกครั้ง: repo สาธารณะ ห้ามมี `.env` วิดีโอ ข้อมูลผู้ทดลอง manifest/ป้าย/answer key จริง

(สำรอง) **deploy หน้าเว็บด้วย CLI** — ตอน repo `MUSULabs/promptpres` เป็น private ขององค์กร แพ็กเกจ Vercel Hobby จึงไม่ deploy จาก GitHub อีก (สถานะ Vercel บน commit ขึ้น failure: "Cannot deploy from a private GitHub organization repository on the Hobby plan") และ `vercel build` บน Windows ล้มเพราะสร้าง symlink ไม่ได้ · หลัง push ขึ้น `main` แล้วให้รัน `./tools/deploy_web.ps1` จากรากของ repo: สคริปต์ยอม deploy เฉพาะเมื่อ HEAD = `origin/main` และไม่มีงานค้าง เขียน `.vercelignore` ชั่วคราวที่ราก ให้ส่งขึ้นเฉพาะ `web/` (ไม่มี `data/`, `models/`, `.env`, โค้ด Python) แล้ว `vercel deploy --prod` ให้ Vercel build แบบเดียวกับ Git deployment (ครั้งแรก 23 พ.ย.: ส่ง 63 ไฟล์ build 6 วินาที alias `www.promptpres.app`) · ตรวจต่อด้วย `python deploy_smoke.py https://www.promptpres.app --direct <Modal>` · Modal ยัง deploy แยกด้วย `modal deploy deploy_modal.py`

D-065 (ใช้อีกครั้งตั้งแต่ 23 พ.ย.): โปรเจกต์ Vercel เชื่อม GitHub `MUSULabs/promptpres` (Root Directory = `web`) ทุก push ขึ้น `main` deploy ขึ้น Production เอง · `web/vercel.json` ติดตั้งด้วย `npm ci` (Vite รุ่นใน `package-lock.json`) และ build ด้วย `npx --no-install vite build` (ไม่ดาวน์โหลด Vite รุ่นอื่น; `tsc` ตรวจใน CI เพราะอ่าน `contracts/` นอก `web/`) · `web/.vercelignore` เป็นรายการไฟล์ที่ไม่ส่งเท่านั้น ห้ามใช้รูปแบบ `/*` แล้วยกเว้นทีละไฟล์ เพราะ Git deployment อ่านไฟล์นี้จากรากของ repo จึงลบ `web/` ทั้งโฟลเดอร์ ดูผล build ด้วย `vercel ls promptpres` และ `vercel inspect <url> --logs`

ใช้ `vercel deploy --prebuilt` เพื่อส่งเฉพาะไฟล์ที่ build แล้ว (ไม่ส่ง `.env` หรือ `data/`) หากเพิ่มโดเมนอื่นในภายหลัง ให้ใส่เป็นรายการคั่นด้วยจุลภาคใน `-Origin` โดยรายการแรกเป็นที่อยู่หลัก ทุกรายการผ่านการตรวจ Origin และ CORS

โดเมนจริง (23 พ.ย. 2569): `promptpres.app` บน Vercel ส่งต่อ (308) ไป `https://www.promptpres.app` เบราว์เซอร์จึงส่ง Origin เป็น `www` · ต้องมีครบทั้ง `https://www.promptpres.app`, `https://promptpres.app` และ `https://promptpres.vercel.app` ใน `-Origin` ไม่อย่างนั้นการเข้าสู่ระบบและทุกคำขอเขียนจะได้ 403 "คำขอต้องมาจากหน้าเว็บ PromptPre's" · เปลี่ยน secret แล้วต้อง `modal deploy deploy_modal.py` เพื่อให้เครื่องที่รันอยู่ได้ค่าใหม่

**พรีวิว `dev.promptpres.app` (24 พ.ย. 2569, D-070):** branch `dev` ขึ้นเป็น Vercel Preview ที่โดเมน `dev.promptpres.app` (Vercel → Settings → Domains ผูกกับ Git branch `dev` + CNAME `dev` ที่ DNS) ใช้ backend ชุดเดียวกับเว็บจริง (Modal + Supabase เดียวกัน) · `-Origin` มี 4 ที่อยู่:

```powershell
& ./tools/set_modal_secret.ps1 -Origin "https://www.promptpres.app,https://promptpres.app,https://promptpres.vercel.app,https://dev.promptpres.app" -DirectOrigin "https://shinrakit--promptpres-web.us-east.modal.run" -Replace
```

- **ค่า secret ใหม่ยังไม่มีผลทันที:** ถ้าโค้ดไม่เปลี่ยน `modal deploy` จะตอบ "Deployment skipped" และเครื่อง `web` ที่รันอยู่ยังใช้ค่าเดิม (อ่าน secret ตอนเครื่องเริ่ม) ไปจนกว่าเครื่องนั้นจะดับเอง (ว่าง 5 นาที) ให้หยุดเครื่องนั้นเองด้วย `modal container list` แล้ว `modal container stop --yes <id>` คำขอถัดไปจะเปิดเครื่องใหม่ที่ได้ค่าใหม่ (ช้าลงไม่กี่วินาที คำขอที่ค้างอยู่ตอนนั้นอาจต้องลองใหม่)
- **ตรวจว่ารับแล้ว:** ส่งคำขอ OPTIONS แบบที่เบราว์เซอร์ส่ง ถ้าได้ 200 พร้อม `Access-Control-Allow-Origin` ตรงกับที่อยู่ แปลว่ารับ ถ้าได้ 400 แปลว่ายังไม่รับ
  ```powershell
  curl.exe -s -o NUL -D - -X OPTIONS https://shinrakit--promptpres-web.us-east.modal.run/api/auth/guest -H "Origin: https://dev.promptpres.app" -H "Access-Control-Request-Method: POST"
  ```
- **Vercel ล็อกพรีวิวไว้โดยค่าเริ่มต้น** (Settings → Deployment Protection → Vercel Authentication) คนนอกทีมจะเจอหน้าเข้าสู่ระบบ Vercel ก่อน ตอนนี้ปิดไว้เพื่อให้ทีมและอาจารย์เปิดได้
- รวม `dev` เข้า `main` = ขึ้นเว็บจริงทันที (Vercel deploy `main` เป็น Production) ทำเมื่อเจ้าของตรวจพรีวิวแล้วเท่านั้น

งานประจำ `maintain` (ทุก 15 นาที) ปลุกฐานข้อมูล (`SELECT 1` กัน Supabase Free หยุดหลังไม่ใช้ 7 วัน) ซ่อมคิวที่ค้าง และลบวิดีโอตามระยะเก็บใน `config/storage-v0.yaml`: Guest 7 วัน บัญชีสมาชิก 30 วัน ไฟล์ดิบที่วิเคราะห์ไม่สำเร็จ 1 วัน ผลวิเคราะห์ (`result_json`) เก็บถาวร ดูสถานะด้วย `modal app logs promptpres` และ `modal volume ls promptpres-media runs` · D-063: `maintain` ใช้ CPU 0.25 หน่วยความจำ 256 MiB ไม่ปักภูมิภาค และปิดเครื่อง 2 วินาทีหลังทำเสร็จ (ค่าเฉลี่ยตอนไม่มีผู้ใช้เดิม ≈ 0.0016 USD/ชั่วโมง เกือบทั้งหมดเป็นเวลาว่าง 60 วินาทีของงานนี้) ดูค่าใช้จ่ายรายชั่วโมงด้วย `modal billing report --for today -r h --show-resources`

**กันเครดิตหมด (D-063, `config/storage-v0.yaml` `guard`):** ก่อนรับวิดีโอเข้าคิว ระบบตรวจทั้งตอนขอตั๋วอัปโหลดและตอนอัปโหลดเสร็จ — บัญชีเดียวรอวิเคราะห์ได้ไม่เกิน 2 รอบ (HTTP 429) · ทั้งระบบรอ/กำลังวิเคราะห์ไม่เกิน 8 รอบ และส่งวิเคราะห์ไม่เกิน 80 รอบใน 24 ชั่วโมง (HTTP 503) · การตรวจครั้งสุดท้ายจองที่ไว้จนบันทึกเข้าคิวเสร็จ วิดีโอที่อัปโหลดเสร็จพร้อมกันจึงผ่านเกินจำนวนไม่ได้ · ชิ้นไฟล์ของการอัปโหลดที่ค้าง (ทุกรอบ) ถูกลบเมื่อเกินอายุตั๋วทุกครั้งที่มีการขอตั๋วใหม่ · การเรียก LLM ระหว่างวิเคราะห์บน GPU ลองซ้ำเฉพาะตามที่ SDK ตั้งไว้ (`llm.max_retries`) ไม่ซ้อนรอบรอเพิ่ม ส่วนการอ่าน PDF ที่ผู้ใช้รออยู่ลองซ้ำหลัง 1/2/4/8 วินาทีภายในเวลาที่กำหนด · ขอตั๋ววิดีโอจากที่อยู่ IP เดียวไม่เกิน 120 ครั้ง/ชั่วโมง (พอสำหรับห้องเรียนหลัง NAT เดียว) · D-066: อ่าน PDF ด้วย LLM ไม่เกิน 100 ไฟล์ใน 24 ชั่วโมงทั้งระบบ (นับตอนเริ่มเรียก รวมครั้งที่ไม่สำเร็จ; HTTP 503) และอัปโหลด PDF ไม่เกิน 30 ครั้ง/ชั่วโมง/IP · ขีดจำกัดต่อ IP เพียงชะลอสคริปต์ เพราะผู้ที่เรียก Modal ตรงตั้ง `X-Real-IP` เองได้ ด่านจริงคือยอดรวมทั้งระบบ · งานที่ทำให้เครื่อง GPU ล้มซ้ำวิเคราะห์ไม่เกิน `runner.max_attempts` = 2 ครั้งแล้วเป็น `failed` และลบไฟล์ดิบ · ตั้งวงเงินใช้จ่ายของ workspace ใน Modal dashboard (Settings → Usage/Billing) เป็นด่านสุดท้าย

สำรองฐานข้อมูล (Supabase Free ไม่มี backup อัตโนมัติ) ด้วย `pg_dump` จาก Docker โดยส่ง URL ผ่าน environment ไม่พิมพ์ออกจอ:

```powershell
$env:PGURL = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -Last 1).Split('=', 2)[1]
docker run --rm -e PGURL postgres:17 sh -c 'pg_dump --no-owner --no-privileges --schema=public "$PGURL"' > data/backup_promptpres.sql
Remove-Item Env:PGURL
```

หยุดบริการทั้งหมดด้วย `modal app stop promptpres` (ข้อมูลใน Supabase และ Volume ยังอยู่)

### ข. Docker Compose บน Cloud GPU VM — Bash

บน VM Linux สำหรับแอปนี้: ติดตั้ง Docker + Compose ≥2.30, NVIDIA driver + Container Toolkit, Caddy และ Python 3 ชี้ DNS มาที่ VM และเปิดพอร์ต 80/443 ก่อนรัน จากโฟลเดอร์ repo เดียวกัน ใช้คำสั่งสร้าง `.env` เฉพาะครั้งแรก:

```bash
nvidia-smi
read -rp 'DNS hostname (no scheme): ' PT_HOST
read -rsp 'OpenRouter API key: ' PT_OPENROUTER_KEY; printf '\n'
PT_AUTH_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
PT_DB_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
(umask 077; set -o noclobber; printf 'PROMPTPRES_PUBLIC_ORIGIN=https://%s\nPROMPTPRES_SESSION_SECRET=%s\nPOSTGRES_PASSWORD=%s\nOPENROUTER_API_KEY=%s\nOPENROUTER_MODEL=google/gemini-2.5-flash-lite\n' "$PT_HOST" "$PT_AUTH_SECRET" "$PT_DB_PASSWORD" "$PT_OPENROUTER_KEY" > .env)
unset PT_AUTH_SECRET PT_DB_PASSWORD PT_OPENROUTER_KEY
printf '%s {\n  reverse_proxy 127.0.0.1:8000\n}\n' "$PT_HOST" | sudo tee /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
docker compose config --quiet
docker compose up --build -d
docker compose logs --tail=60 worker
python3 deploy_smoke.py "https://$PT_HOST"
```

ก่อนหยุดรอคิวว่าง ใช้ `docker compose stop` เพื่อเก็บ volumes และ `docker compose start` เมื่อต้องกลับมาใช้

**ก่อนเปิด SUS:** Smoke ต้องผ่าน จากเบราว์เซอร์จริงลองกล้องและอัปโหลด → รอคิวจนได้ผล 8 เกณฑ์ ตรวจ Coach และประวัติ 2 รอบ; ทดสอบการโอน Guest เมื่อสมัคร สองบัญชีเปิดรอบของกันไม่ได้ และผลกับวิดีโอยังอยู่หลัง restart ขณะคิวว่าง ทดลองอัปโหลดขนาดที่จะใช้จริงและคลิป 20 นาทีตามแผนก่อนเคลมว่ารองรับ อัปโหลดบน Modal ส่งเป็นชิ้น 8 MB ตรงไปที่ Modal พร้อมลองซ้ำชิ้นละ 3 ครั้ง ดูขั้นตอนสำรองข้อมูล ค่าใช้จ่าย และวินิจฉัยคิวใน [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md)
