# prompts/

Prompt files with a version in the name (`topics-v1.txt`, `coverage-v1.txt`, `requote-v1.txt`), read by `promptpres_shared/llm_client.load_prompt`. The version used is logged in `versions.prompt` of every result (e.g. `coverage-v1 + requote-v1`). Never edit a released (committed) prompt in place — add a new version. The coverage cache key includes the prompt text, so an edit never reuses an old answer.

Topic drafts from a PDF use `topics.PROMPT` (`promptpres_shared/topics.py`), currently **topics-v2** (14 Nov 2026). Compared with v1 it:
- adds a document gate (`is_valid_document` + `rejection_reason`): a receipt, menu, form or code listing gets a 422 with a Thai message;
- tells the model to skip admin pages (revision table, TOC, references, …);
- asks for 5–8 merged presentation topics (max 10), with sub-sections listed in `key_point`.

Why: a real 80-page report (Solar Rooftop, A05_3) came back as 12 topics under v1, and the whole draft was thrown away.

Live check with gemini-2.5-flash-lite, after `pdf_text` was changed to read every page:
- Solar Rooftop (chapters 1–3): 8 topics in about 10 s, about 38k input tokens. The same in two runs, and no invented results/conclusion topics.
- Our own approved thesis PDF: 7 topics.
- A menu/receipt PDF: rejected in about 1 s.
- Since `clean_topics` no longer raises above 10, a longer draft is kept (first 15) with a note.

The pipeline uses `coverage.PROMPT` (`worker/llm/coverage.py`), currently **coverage-v1**.

`coach-v1.txt` (15 Nov 2026, D-046) is read by `worker/llm/coach.py`. Its input (D-050) is the 8 scored cards, the confirmed topics (planned / spoken order, C2 status, verified quote) and the transcript text overlapping each evidence span (≤ `coach.snippet_max_chars` characters, at most `coach.max_evidence_per_criterion` spans per criterion; never the whole transcript). It must answer strengths / focus / plan and quote evidence times as `[m:ss]`. The Evidence Verification Guard in `coach.py` rejects the whole answer when a time is outside the clip or more than `coach.match_tolerance_s` from that criterion's evidence, when a strength is not level 3–4, or when a banned phrase appears.

`coach-v2.txt` (18 Nov 2026, D-064) replaces coach-v1 in the pipeline (`coach.PROMPT`, `pipeline-v0.yaml` `coach.prompt_revision: coach-v2`; same input, same guard). Why: on the live service the coach for team clip G09_P18_S04_T01 was rejected because the model wrote the banned eye-contact word, which coach-v1 itself spelled twice in its rules. Changes:
- N2 and the rules describe gaze and feelings without naming the banned words, and say what to write instead (หันหน้าเข้าหาผู้ฟัง, หันหน้าตรง, เงยหน้าขึ้นจากโน้ตหรือจอ).
- A focus time must be copied from `at` or `until` of the same criterion; T1 uses เริ่มพูด / จบการพูด; brackets only for copied times (targets and durations as plain text); C2 is a focus only for a partly covered topic with its time; topics never mentioned go to the plan.
- A final self-check of times and wording before answering.
A/B on the 29 local run folders with real cards and transcripts (`gemini-2.5-flash-lite`, temperature 0, two passes with identical counts): coach-v1 accepted 24/29 (rejected: banned word 3 [สบตา 2, มั่นใจ 1], missing time 1, wrong time 1); coach-v2 accepted 26/29 (banned word 0, missing time 1, wrong time 2). Both still sometimes advise เงยหน้ามองผู้ฟัง / มองกล้อง (head direction advice, not a claim about eye contact; not a banned phrase). Changing `prompt_revision` changes the config digest in `versions.config` from `60915b8fed09` to `4073549cb223`; no measurement or threshold changed.

`coverage-v2.txt` (14 Nov 2026) = v1 with stricter clear / brief definitions (one short sentence or the topic name only = brief; unsure = brief). Tested with `python -m worker.dev_coverage --prompt coverage-v2 --scenarios S01 S11` on cached transcripts and **not adopted**:
- S01 stayed 16/16 clear.
- S11 matched the recording protocol on 7/20 topic labels, vs 8/20 with v1.
- In the S11 transcripts the speakers actually explained the topic the protocol said to skip, so these clips cannot test strictness. That needs per-topic human labels (`eval/templates/gt_topics.csv`).
- v2 also turned one partly explained topic (P07 H01) into not_mentioned.
