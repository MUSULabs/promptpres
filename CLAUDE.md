# PromptPre's (พร้อมพรีต์, technical slug `promptpres`) — read this every time

ระบบวิเคราะห์พฤติกรรมการซ้อมนำเสนอ (โครงงาน CS ม.พะเยา) สเปกเต็ม: vault `Knowledge/03_System_Design/SPEC_V2.md` · แผน: `Knowledge/00_Control/PLAN.md` (vault root = `../..`)

## What the system does
Spec **v2.4** (vault `Knowledge/03_System_Design/SPEC_V2.md`). User records in the browser (MediaRecorder) or uploads a rehearsal video + project-report PDF + target time. After the session, a GPU worker analyses it and the web shows **8 criterion cards in 4 skills — no total score, no grades**. Each card: level 1–4 **or** "วิเคราะห์ไม่ได้" with a reason, measured values with units, supporting info shown apart and labelled "not a criterion", clickable evidence timestamps (video seeks), template feedback by `feedback_id`, a 4-step level band with a plain-language reading (`interpret` in the feedback yaml), and a badge vs the previous finished rehearsal. Codes follow the approved thesis (C, S, N, T).

D-046 adds three layers around the cards (Result Contract 1.2; current version 1.3 from D-050): (1) levels come only from `config/thresholds-*.yaml` — no LLM sets a level; (2) an evidence timeline and an interactive transcript (fillers S3, long pauses S2) under the video, `GET /api/sessions/{id}/transcript`; (3) an evidence-grounded AI coach (strengths / focus / plan, `[m:ss]` times checked against the evidence), a per-criterion trend table on the history page (levels the system measured, not proof of skill gain), and presentation templates on `/new`.

D-050 (Result Contract 1.3, rubric v0.9) makes it a cloud web app: accounts (`api/app/auth.py`: register / login / one-click Guest / logout / me, PBKDF2 passwords, HMAC-signed `pt_session` cookie, a Guest's rehearsals move to the new account in one transaction on register), FastAPI serves `web/dist` on one origin, `Dockerfile` + `docker-compose.yml` (API, PostgreSQL, GPU worker) and `deploy_modal.py` — see `PILOT_RUNBOOK.md`. The result page opens with `SkillRadar` (8 axes, levels 1–4, unanalyzable = translucent dot outside the scale, never 0, no total). S3 also counts contextual verbal tics (`config/pipeline-v0.yaml` `fillers`); evidence carries an optional `label`. Trend table "แนวโน้มผลการฝึกซ้อมข้ามรอบ" and badges ↑ ดีขึ้นจากรอบก่อน / = คงที่ / ↓ ลดลงจากรอบก่อน compare rubric drafts v0.7–v0.9 with each other (`web/src/trend.ts` `compatibleRubric`), other versions only with themselves. On-screen names: S3 เสียงเติมและคำติดปาก, N1 การใช้ท่าทางมือประกอบการพูด, N2 การหันหน้าสื่อสารกับผู้ฟัง (what is measured is unchanged: hand-still spans, head direction).

| Code | Skill | Measures | Tools |
|---|---|---|---|
| C1 | content | topic order vs plan: Kendall's tau-b of the order each topic is first substantively explained (from C2) vs confirmed order; value shown with ≥3 clear topics, level with ≥4 | from C2 |
| C2 | content | semantic coverage: % confirmed topics clear / brief / not_mentioned, evidence quote verified in transcript | LLM + transcript |
| S1 | speech | syllables/s excluding pauses | Whisper + PyThaiNLP |
| S2 | speech | long pauses/min + longest pause | Silero VAD |
| S3 | speech | filled pauses (เอ่อ/อ่า/อืม/เอิ่ม/uh/um, list in thresholds yaml) + contextual verbal tics (D-050: 8 phrases such as แบบว่า/ก็แบบ; แบบ/ก็คือ/คือ only when repeated or within 0.5 s of a filler sound; compounds like แบบจำลอง never) per min; "เออ" = yes is not counted; S1 still excludes filler sounds only | Whisper (+ audio detector if needed) |
| N1 | body | continuous hand-still spans: spans/min + longest (hand-activity % = supporting info only) | MediaPipe Pose/Hand |
| N2 | body | head direction every 1 s from yaw/pitch: down (checked first) / side / up-other / front; level from % front (NOT eye contact) | MediaPipe Face |
| T1 | time | % deviation of speech span from the per-session target (same bands short or long); target entered by the user, default 15 min (programme rule 15–20 min) | ffprobe + VAD |

Scope confirmed by the advisor on 12 Nov 2026 (8 criteria, D-033). Body sway is not a criterion. Repeated hand/arm motion is NOT measured (beat gestures repeat naturally). Hand-gesture meaning is never interpreted.

## N1/N2: current legacy measurement vs frozen target design (D-067, Scope Freeze v1.0)
Status: **OWNER_APPROVED / ADVISOR_APPROVED** (advisor 22 Nov 2026; project title unchanged). Phase 2 (research tooling under `research/`, masked pilot media, pilot labelling) is allowed; production N1/N2 stays frozen. **Before touching N1 or N2, read** `research/SCOPE_FREEZE_V1.md`, `research/ANNOTATION_MANUAL_N1_N2_V1.md` and `research/EXPERIMENT_PROTOCOL_V1.md` (plus `research/LABEL_PROVENANCE_V1.md` for any labelling or AI pre-annotation work).
- **CURRENT LEGACY MEASUREMENT (what runs today, Spec v2.4):** the N1/N2 rows in the table above — `worker/criteria/n1.py` hand-still spans, `n2.py` head yaw/pitch rule, extractor `worker/extract/landmarks.py` (nose, shoulders, wrists, head angles only). Legacy N1 is known to be construct-misaligned (level 1 or unanalyzable on all 8 SC02 rater clips, `data/eval_sc02_v0_9/sc02.md`).
- **FROZEN TARGET DESIGN (approved, NOT implemented):** N1 "พฤติกรรมมือระหว่างการนำเสนอ" = speaker-disjoint classifier of `GESTURE / REST_OR_HOLD / ADAPTOR_MANIPULATION / UNOBSERVABLE` (+ flags, continuous intensity); N2 "ทิศทางการมองเทียบแนวกล้อง" (Camera-Relative Visual Direction) = `CAMERA_REGION / NOTES / OTHER / UNOBSERVABLE` from head + eye features. MediaPipe = fixed feature extractor; the classifier is trained by the team (this is not fine-tuning).
- **Legacy N1/N2 is not a production fallback for the target design.** If a target model fails its deployment gate the card says "ข้อมูลยังไม่เพียงพอสำหรับการวิเคราะห์"; N2 head-only may ship only after validation and renamed to what it measures.
- Never describe the target design as implemented. Do not change `n1.py`, `n2.py`, `landmarks.py`, `thresholds-v0.yaml`, the Result Contract, DB, API or UI for N1/N2 until a later phase is approved by the owner. SC02 clips of P18–P20 (team, group G09) never enter a reported primary metric; scenario IDs are never labels.

D-062 (Spec v2.4, contract stays 1.3) deploys it: web on Vercel (`web/vercel.json` rewrites `/api/*` to Modal), PostgreSQL on Supabase `us-east-1` (Session Pooler 5432; migration v4 turns on RLS), Modal `web` (CPU, us-east, scale to zero) + `Analyser` (T4, spawned per upload, max 4) + `maintain` (every 15 min: DB ping, queue sweep, video retention). Uploads go in 8 MB chunks straight to Modal with a signed ticket (`api/app/uploads.py`); files live in Modal Volume v2 `promptpres-media` through `promptpres_shared/storage.py` hooks (the CPU tier never mounts it). After analysis only `playback.mp4` (≤480p) and small JSON files are kept; guest videos 7 days, members 30 days (`config/storage-v0.yaml`). Measuring code and `config/pipeline-v0.yaml` are unchanged.

D-063 (post-deploy QA, no contract or measurement change): credit guard before a video joins the queue (`api/app/uploads.py` `check_queue`, `config/storage-v0.yaml` `guard`: 2 waiting rounds per account, 8 for everyone, 80 per 24 h, 120 video tickets per IP per hour; the final check holds a place under a process lock until the round is committed to the queue, so uploads finishing together cannot both pass — `uploads.ADMITTING`); chunks are deleted as they are joined, unfinished chunk folders of every session pruned after the ticket lifetime on each new ticket, the web container's local copy cache trimmed to `media.cache_max_mb` (`storage.trim_cache`); `maintain` runs on 0.25 CPU / 256 MiB with no region pin and `scaledown_window=2`. `llm_client`: calls with a deadline (PDF topics while the user waits, SDK retries off) ask a busy provider again after 1/2/4/8 s (429 "rate-limited upstream", 5xx, dropped connection) within the deadline; calls without one (coverage, coach on the T4) keep only the SDK's `max_retries`, so a hung provider cannot hold the GPU for 5× the retries.

D-065 (scrutiny fixes, no contract or measurement change): the queue-guard place-holding, all-session chunk pruning and deadline-only LLM busy retry above; Vercel deploys from GitHub (Root Directory `web`): `web/vercel.json` `installCommand: npm ci`, `buildCommand: npx --no-install vite build` (locked Vite 6; `tsc` runs in CI), `web/.vercelignore` is an unanchored blocklist — never `/*` with exceptions, Git deployments read it from the repo root.

D-066 (sprint-close scrutiny, no contract or measurement change): LLM credit guard for report PDFs (`uploads.check_pdf`, `guard.pdf_reads_per_day` = 100 for everyone, counted when the call starts so failed calls count, plus the day's successful reads from `topics_versions` after a restart; `pdf_tickets_per_ip_hour` = 30 on both PDF routes); upload ids must be 32 hex on every route; the database engine logs failed statements without their values (`hide_parameters`); web: Thai text when the network is down, a leave-page warning while a video uploads, and the login tab tells a Guest that only registering moves their rounds. Known and accepted: `X-Real-IP` can be set by a caller who skips Vercel, so per-address limits only slow a script; the daily totals are the real stop.

## Layout
```
contracts/  result.schema.json + mocks/ — THE interface between worker and web
config/     thresholds-*.yaml, feedback-*.yaml — every threshold and feedback text lives here
api/        FastAPI (routes; app/auth.py = accounts and login cookie; app/boundary.py = Pilot identity, Origin check, size caps), tests/
promptpres_shared/  code used by both api and worker: store (DB + queue), contract, settings, topics, llm_client, migrations
web/        React + Vite + TS (src/contract.ts = TS mirror of the schema)
worker/     analysis pipeline + runner (queue = sessions table)
tools/      dev scans of the SC02 dataset (read-only), reuse worker functions
dev.py      starts API + web + worker for local use
pilot.py    private multi-user trial over Tailscale (see PILOT.md); PERFORMANCE.md = timing on the GTX 1650 4GB
.github/    workflows/checks.yml: ruff, pytest, tsc, build, Playwright
eval/       chapter 3/4 statistics (IOC, calibration, measurement accuracy, agreement, SUS); config/eval-v0.yaml
research/   D-067 N1/N2 research protocol (target design, not implemented): scope freeze, annotation manual, label schema + tests, experiment protocol, provenance, templates, expert forms. Real manifests/labels/answer keys are private, outside git
models/     model weights, gitignored
data/       uploads/runs, gitignored
```

## Rules
1. **Contract first.** Changing any field = edit `result.schema.json`, `promptpres_shared/contract.py`, `web/src/contract.ts`, mocks, and bump `contract_version`. `python -m pytest worker/tests api/tests eval/tests` must pass.
2. **No thresholds or feedback text in code.** Read from `config/`. Numbers must trace to the rubric and a verified source or documented calibration. Only keys in `scored_values` (thresholds yaml) may set a level; other `values` keys are supporting info (`GET /api/criteria`).
3. **Measuring code must be readable line by line** — the committee will ask how each value is computed. Prefer plain numpy over clever abstractions.
4. **Every criterion fails independently**: wrap in try/except → `status: "unanalyzable"` + human-readable Thai `reason`. Unanalyzable is never level 1.
5. **Never infer** emotion, confidence, anxiety, personality, eye contact, or the meaning of hand gestures.
6. **LLM** calls go through OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` in `.env`, see `.env.example`; budget ≤ 10 USD/month; pin an exact model id). The evidence-grounded coach (D-046, `worker/llm/coach.py`, prompt `coach-v2` since D-064) sees the scored cards, the confirmed topics (planned/spoken order, C2 status, verified quote) and the transcript text overlapping each evidence span (≤ `coach.snippet_max_chars` = 80 characters, at most `coach.max_evidence_per_criterion` spans per criterion; never the whole transcript; missing data is sent as `coach.missing_text`), may not change levels, must cite `[m:ss]` times from that criterion's evidence (±`coach.match_tolerance_s`), temperature 0, JSON output; any kept item that fails the guard → `coach: null` (extra items beyond a section limit are dropped and counted in `hidden_count`).
7. **Real videos never go into git.** Don't modify `D:\Obsidian\SENIOR-PROJECT\Data` originals.
8. Log model name, rubric/config/prompt version in every result (`versions`).
9. Small tasks with an explicit "done when". Times are seconds from video start.

## Run
- Cloud (D-050, see `PILOT_RUNBOOK.md`): `docker compose up --build -d` = API + built web on `127.0.0.1:8000`, PostgreSQL, GPU worker; needs `POSTGRES_PASSWORD`, `PROMPTPRES_SESSION_SECRET`, `PROMPTPRES_PUBLIC_ORIGIN` and an HTTPS reverse proxy. Vercel + Supabase + Modal (D-062): `DEPLOY_RUNBOOK.md` section ก (`modal deploy deploy_modal.py`, `modal run deploy_modal.py::download_models`, web: push `main` and Vercel deploys from GitHub (the repo is PUBLIC since 23 Nov 2026: never commit `.env`, videos, participant data or real manifests/labels/answer keys); fallback `./tools/deploy_web.ps1` (remote build of `web/` only) if Git deployment is unavailable, `python deploy_smoke.py <web> --direct <modal>`)
- Local: `pip install -r api/requirements.txt -r worker/requirements.txt`, `cd web && npm ci`, then `python dev.py` (API + web + `python -m worker.runner`; SQLite `data/promptpres.db`)
- Worker alone: `python -m worker.runner` (queue = `sessions` table in `promptpres_shared/store.py`; `--once` = drain and exit)
- Mock video for result pages: set `PROMPTPRES_MOCK_VIDEO=<path to any local mp4>` before starting the API
- Chapter 3/4 tables: `python -m eval.ioc|calibrate|measurement_eval|agreement_and_sus …` (see eval/README.md; outputs in data/eval/)
- Tests (repo root, same as CI; `api/tests/test_deploy.py` needs `web/dist`, so run `npm run build` in `web/` first): `python -m pytest worker/tests api/tests eval/tests -rs` · `cd web && npm run typecheck && npm run build && npm run test:browser`
