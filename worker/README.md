# worker/

งานวิเคราะห์ที่รันบนเครื่อง GPU ผ่านคิว (ตาราง sessions ใน `promptpres_shared/store.py`, รันด้วย `python -m worker.runner`)

```
prep      FFmpeg: webm→mp4, เสียง mono 16 kHz, ตรวจความดัง/fps
extract   ครั้งเดียวต่อ session: transcript.json (คำ+เวลา), vad.json, landmarks.parquet (~10 fps)
criteria  C1 C2 S1 S2 S3 N1 N2 T1 — แต่ละตัวอ่าน threshold จาก config/ และครอบ try/except → unanalyzable + reason
          ค่าใน values ที่ไม่อยู่ใน scored_values = ข้อมูลประกอบ ห้ามใช้คิดระดับ
result    ประกอบ Result Contract (contracts/result.schema.json) แล้ว validate ก่อนบันทึก
```

โมเดลที่มีอยู่แล้วใน `../models/` (ไม่อยู่ใน git, ตรวจ 14 พ.ย. 2569): faster-whisper `large-v3` (ไม่มี `medium` — ดาวน์โหลดเพิ่มเฉพาะถ้าผลทดลอง ASR เลือกรุ่นนี้), MediaPipe `face.task`, `hand.task`, `pose.task` (pose = รุ่น lite; sha256 ใน `download_provenance.json`)

## โครงไฟล์ (ทั้ง 8 เกณฑ์ทำงานจริง)

```
runner.py        คิว: หยิบรอบจากตาราง sessions ทีละรอบ, คืนงานที่ค้าง processing (max_attempts) -> pipeline
pipeline.py      run_session(video, session_id, target_duration_s, reuse, topics) -> data/runs/<id>/result.json + timing.json
dev_run.py       รันคลิป SC02 จาก config/dev_clips_sc02.yaml (เป้าหมาย T1 = เวลาเป้าของฉาก, หัวข้อ = references/Pxx.json)
session.py       ข้อมูลของรอบวิเคราะห์ (prep/vad/transcript/fillers/landmarks/topics/coverage) + ช่วงพูด (speech_window)
settings.py      ตัวชี้ไป promptpres_shared/settings.py (path, config/pipeline-v0.yaml, ffmpeg/ffprobe, .env)
artifacts/       บันทึกผลแต่ละขั้นผ่าน manifest (เขียนไม่ครบ = ไม่ใช้เป็น cache)
prep.py          ffprobe + ffmpeg -> media.mp4, audio.wav (16 kHz mono), prep.json (flags: ไม่มีเสียง/เบา/สั้น)
extract/         vad.py (Silero ที่มากับ faster-whisper) -> vad.json · asr.py (large-v3 batched) -> transcript.json
                 landmarks.py (pose/hand/face 10 fps) -> landmarks.parquet · fillers.py -> fillers.json
criteria/        base.py · c1 c2 s1 s2 s3 n1 n2 t1
llm/             client.py, topics.py = ตัวชี้ไป promptpres_shared/llm_client.py (OpenRouter: temperature 0, JSON, รุ่นต้องล็อก, retry) และ topics.py (PDF -> ร่างหัวข้อ)
                 coverage.py (ป้ายต่อหัวข้อ + ตรวจ quote กับ transcript, ถามซ้ำ 1 รอบ, cache) -> coverage.json
prompts/         topics-v2.txt (ใช้อยู่; v1 เดิม) · coverage-v1.txt (ใช้อยู่) · coverage-v2.txt (ทดลอง ไม่ใช้) · requote-v1.txt
dev_coverage.py  รัน C2/C1 ใหม่ด้วย prompt อื่นบน transcript เดิม (ไม่แตะ result.json) เทียบกับโปรโตคอล S01/S11
tests/           pytest — ไม่ต้องใช้โมเดล (ข้ามเทสต์ ffmpeg/VAD อัตโนมัติถ้าไม่มี)
```

ASR บนการ์ดจอ 4 GB (GTX 1650): `pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"` แล้ว `asr.py` จะเพิ่มโฟลเดอร์ `site-packages/nvidia/*/bin` เองบน Windows · ลำดับอุปกรณ์ใน `config/pipeline-v0.yaml`: cuda int8_float16 → cuda int8 → cpu int8 (8 threads), batch 2 · ถ้าไม่มี cuBLAS/cuDNN จะข้าม CUDA ไป CPU ทันที (เคยค้าง 16 นาทีเมื่อลอง CUDA ซ้ำหลังล้มเหลว)

ทิศของมุม (ตรวจกับ SC02 S09 14 พ.ย.): pitch < 0 = ก้ม, pitch > 0 = เงย, |yaw| = หันข้าง (`landmarks.PITCH_SIGN`) · เสียงเติม: Whisper ถอดออกมาแต่แยกเป็นชิ้น 1-3 ตัวอักษร ต้องต่อก่อนเทียบ (เฟส 1 จึงนับได้ 0)

LLM: key/รุ่นอยู่ใน `.env` (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`; ถ้ารุ่นว่างใช้ `llm.model` ใน config) ·
รุ่นต้องเป็น `vendor/name` ที่ล็อกแล้ว (ห้าม `:free`, preview, latest, `openrouter/auto`) และบันทึกใน `versions.llm` ·
HTTPS ตรวจใบรับรองกับที่เก็บของระบบปฏิบัติการ (`truststore`) เพราะบนโน้ตบุ๊ก Windows ใช้ certifi อย่างเดียวแล้วต่อไม่ได้ ·
C2 ไม่เชื่อ LLM: quote ต้องหาเจอใน transcript (ตรงตัวหลังตัดช่องว่าง/NFKC หรือคล้าย ≥ `quote_min_ratio` ใกล้บรรทัดที่อ้าง)
ไม่เจอ = ถามซ้ำ 1 รอบ แล้วยังไม่เจอ = `not_mentioned`; เวลาหลักฐานมาจากชิ้นคำที่ quote ตรง ไม่ใช่จาก LLM ·
C1 ใช้เฉพาะหัวข้อ `clear` (config `counted_labels`) ให้ระดับเมื่อ ≥ 4 หัวข้อ, 3 หัวข้อแสดง τ อย่างเดียว ·
ผล LLM เก็บใน `coverage.json` พร้อม `cache_key` (รุ่น + ข้อความ prompt + หัวข้อ + transcript + ค่าตรวจ)
นำกลับมาใช้เมื่อเปิด reuse และ manifest ตรงกับ SHA-256 และรูปแบบของวิดีโอ
`--fresh` ไม่อ่าน cache ขั้นใด รวม C2; manifest รุ่นเดิมจะคำนวณใหม่หนึ่งครั้ง

ไม่มี `n3.py` (ตัดเกณฑ์โยกตัว D-033)

`llm/coach.py` (D-046, prompt `coach-v2` ตั้งแต่ D-064): หลังได้การ์ด 8 ใบ ส่งผลที่คำนวณแล้ว (ระดับ ค่า หลักฐาน เหตุผล) หัวข้อที่ยืนยัน (ลำดับตามแผน/ที่พูด สถานะ C2 quote ที่ตรวจแล้ว) และบทพูดเฉพาะช่วงหลักฐาน (ไม่เกิน `coach.snippet_max_chars` = 80 ตัวอักษรต่อจุด, D-050) ให้ LLM สรุปเป็นจุดที่ทำได้ดี / จุดที่ควรโฟกัส / แผนฝึกรอบหน้า — ไม่ส่งบทพูดทั้งหมด ข้อมูลที่ไม่มีส่งเป็น "ไม่มีข้อมูล" · Evidence Verification Guard ตรวจทุกข้อ: เวลา `[m:ss]` ต้องอยู่ในคลิปและห่างจากช่วงหลักฐานของเกณฑ์เดียวกันไม่เกิน `coach.match_tolerance_s`, จุดแข็งต้องเป็นระดับ 3–4, ไม่มีวลีใน `coach.banned_phrases` · ข้อใดไม่ผ่านหรือ LLM ล่ม = `coach: null` (เหตุผลใน `timing.json` `coach_error`) โดยการ์ดไม่เปลี่ยน · cache ใน `coach.json`

```
python -m pytest worker/tests -q                                   # จาก Code/promptpres
python -m worker.pipeline <video> --session-id ID --target-s 900 --topics topics.json   # คลิปเดียว
python -m worker.llm.topics report.pdf --out topics.json           # ร่างหัวข้อจาก PDF (ผู้ใช้แก้/ยืนยันก่อนใช้)
python -m worker.dev_run --set primary_baseline --limit 1          # คลิป SC02 (อ่านอย่างเดียว; ใช้ผลเดิมของวิดีโอเดียวกัน)
python -m worker.dev_run --fresh --clips G07_P05_S09_T01           # รันทุกขั้นใหม่
python tools/scan_sc02.py                                          # สแกน SC02 ใหม่ -> config/dev_clips_sc02.yaml (เก็บ notes เดิม)
python tools/scan_s09_yaw.py                                       # หันข้างใน S09 ทุกคน -> notes.n2_side_turn_s09
python tools/explore_n2.py G07_P05_S09_T01                         # ไทม์ไลน์ yaw/pitch รายวินาที (ตรวจทิศ)
python tools/explore_s3.py --show                                  # เทียบเสียงเติมทางข้อความ/ทางเสียง ทุกคลิปที่รันแล้ว
```
