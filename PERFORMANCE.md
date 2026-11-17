# PromptPre's local performance check

Measured 14 November 2026. Baseline source: `69e3d80` (pre-D-061 history, not in this repo; see D-061). Baseline checks: 298 Python tests, TypeScript check and build.

| Case | Result |
|---|---|
| History, 100 newly created sessions, SQLite/WAL, 50 HTTP TestClient calls after warm-up | p50/p95 improved from 42.24/64.81 ms to 6.17/7.10 ms. Same API wrapper and scratch DB; swapped only the original store query loop and new batch query. SELECT count for those rows: 101 → 1. |
| Worker, first run: generated 15-minute 320×240 H.264/AAC test pattern and tone, 12,767,508 bytes; Windows, GTX 1650 4 GiB, faster-whisper large-v3 CUDA int8_float16, LLM disabled | 281.1 s total: prep 1.1, landmarks 259.9, VAD 1.8, ASR 17.9, fillers <0.1, criteria 0.2. |
| Same input and settings, new worker process with committed artifacts | 0.4 s total; prep, landmarks, VAD, ASR and fillers reused. This is a disk-cache hit, not a warm-model benchmark. |

The clip contains no actual presenter or speech; this run cannot establish scientific validity, full-length videoconference upload performance or peak RAM/VRAM on the target GPU machine. Repeat on the designated host with approved development clips, a real 20-minute recording, cold and warm runs, and process peak working set / GPU memory sampling before changing ASR model lifetime or sampling rates. The code still unloads ASR after each clip.

Follow-up audit, 14 November 2026: compared the pre-audit history projection (all session columns) to the narrower projection on identical scratch SQLite/WAL data, half with stored results and confirmed topics. Each figure is the median of three rounds (40 HTTP calls per version after warm-up; order alternated). Responses matched and both projections used one SELECT per request.

| Synthetic sessions | p50 before → after | p95 before → after |
|---|---:|---:|
| 100 | 8.13 → 7.98 ms | 9.29 → 8.89 ms |
| 1,000 | 57.28 → 55.36 ms | 62.54 → 58.67 ms |

The counts include the HTTP wrapper and JSON serialization; the speed difference is modest. Keep the narrower projection because the list endpoint does not need stored paths or settings. The session detail view also reads the latest two topic kinds in one SELECT instead of two.

On a separate 18-second synthetic clip with LLM disabled, the current worker took 21.6 s uncached and 0.1 s with committed artifacts. SHA-256 input identification took 0.003 s in each run; all eight criterion payloads matched. The cache-hit timing is not a comparison of model performance.

## Real speech clips (SC02), 16 November 2026

Source `1e2ef11` (pre-D-061 history, not in this repo; see D-061) plus the D-051 working tree (no pipeline change). Same laptop (Windows 11, GTX 1650 4 GiB), faster-whisper large-v3 CUDA int8_float16, LLM on (`google/gemini-2.5-flash-lite` through OpenRouter), config `thresholds-v0 + pipeline-v0.9`, rubric v0.9. One worker process ran both clips in this order with `python -m worker.dev_run --fresh --clips G01_P02_S01_T01 G01_P02_S04_T02`, so every stage was recomputed and the first clip also carries the first model load. Figures are seconds from each run's `timing.json`.

| Stage | G01_P02_S01_T01 (natural presentation, 175.0 s) | G01_P02_S04_T02 (inserted pauses, 64.7 s) |
|---|---:|---:|
| prep | 0.8 | 0.7 |
| landmarks | 114.7 | 38.1 |
| vad | 0.8 | 0.1 |
| asr | 109.2 | 37.4 |
| fillers | 0.6 | <0.1 |
| coverage (LLM) | 9.5 | 1.5 |
| criteria | 0.2 | 0.1 |
| coach (LLM) | 2.5 | — (see below) |
| **total** | **238.5** | **80.4** |
| total / clip length | 1.36 | 1.24 |

On the second clip the coach reply was rejected by the evidence guard (`coach_error`: a focus item on C2 cited no evidence time), so the result has `coach: null` and no coach time is recorded; the eight cards were unaffected. Landmarks and ASR together are 94 % of the time on both clips (about 0.6 s of work per second of video each).

Limits: two clips of one presenter, one run each, on the development laptop; not a cloud GPU timing, no peak RAM/VRAM sampling, and still no real 15-20 minute recording. LLM stage times include network latency.

## SC02 rater clips, full v0.9 batch, 17 November 2026

Source `92b3977` (no pipeline change since `d73fca0`; both pre-D-061 history, not in this repo; see D-061). Same laptop and settings as above (GTX 1650 4 GiB, faster-whisper large-v3 CUDA int8_float16, `google/gemini-2.5-flash-lite`, `thresholds-v0 + pipeline-v0.9`, rubric v0.9, prompts `coverage-v1 + coach-v1-d050`). `python -m eval.run_sc02 --allow-openrouter` ran the 8 clips of `config/eval_clips_sc02.yaml` (8 speakers, 61–175 s each) one after another in one process with no cache. Figures are seconds from each clip's `timing.json`, copied to `data/eval_sc02_v0_9/run_details.json`.

| Clip | Length | landmarks | asr | coverage (LLM) | coach (LLM) | other | **total** | total / length |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| G01_P02_S01_T01 | 175.0 | 116.3 | 104.2 | 5.4 | 2.2 | 2.1 | **230.2** | 1.32 |
| G01_P03_S01_T01 | 152.5 | 89.9 | 96.9 | 2.4 | — | 3.5 | **192.7** | 1.26 |
| G06_P17_S01_T02 | 115.4 | 65.1 | 68.2 | 2.8 | — | 3.9 | **140.0** | 1.21 |
| G09_P18_S04_T01 | 67.8 | 41.9 | 51.1 | 3.9 | 2.5 | 1.0 | **100.4** | 1.48 |
| G07_P05_S05_T01 | 69.2 | 44.6 | 45.0 | 3.6 | 2.8 | 1.1 | **97.1** | 1.40 |
| G03_P07_S08_T01 | 74.3 | 45.4 | 53.7 | 1.9 | 2.6 | 1.2 | **104.8** | 1.41 |
| G09_P19_S09_T01 | 61.1 | 39.4 | 44.5 | 1.8 | — | 3.2 | **88.9** | 1.45 |
| G05_P11_S10_T01 | 97.5 | 57.3 | 71.6 | 1.9 | — | 4.1 | **134.9** | 1.38 |
| **8 clips** | **812.8** | **499.9** | **535.2** | **23.7** | **10.1** | **20.1** | **1,089.0** | **1.34** |

"other" = total minus the listed stages (input hash, prep, VAD, fillers, criteria, and time not assigned to a stage). Landmarks and ASR are 95 % of the batch. On 4 clips the coach reply was rejected by the evidence guard (`coach: null`), so no coach time is recorded; the cards were unaffected. A first attempt of the same batch was discarded because the C2 LLM call failed on G01_P02_S01_T01 (`LLMError` after the client's retries); the rerun above is the kept result. Short clips run slower per second of video (1.40–1.48) because fixed costs such as the per-clip ASR model load weigh more.

Limits: one run per clip on the development laptop, no peak RAM/VRAM sampling, no cloud GPU timing and still no real 15–20 minute recording. LLM stage times include network latency.
