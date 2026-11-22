---
doc: research/SCOPE_FREEZE_V1
version: v1.0 (Phase 1.2 + 1.2a corrections within D-067, 22 Nov 2026)
date: 2026-11-22
status: OWNER_APPROVED / ADVISOR_REVIEW_PENDING
decisions: D-067 (builds on D-033, D-028, D-046)
implementation: TARGET DESIGN — not implemented; current system = Spec v2.4
owner_approval: approved 2026-11-22
advisor_approval: pending (N1/N2 redesign, IOC addendum, proposed title)
authority: vault Knowledge/01_Project/SCOPE_FREEZE_V1.md is the authority for scope; this file repeats only what code and data work need
---

# Scope Freeze v1.0 — repository summary

## 1. What stays

Eight criteria, no total score, no inference of emotion, confidence, anxiety or personality (CLAUDE.md rule 5).

| Role | Codes | Claim limit |
|---|---|---|
| Supporting criteria | C1 C2 S1 S2 S3 T1 | C1/C2: "checked against the plan the user reviewed and confirmed" only. T1: against a target the user entered or confirmed (no silent 15-minute default in the target design). |
| Research Core | N1 พฤติกรรมมือระหว่างการนำเสนอ · N2 ทิศทางการมองเทียบแนวกล้อง (Camera-Relative Visual Direction) | Observable hand behaviour and camera-relative visual direction only. Never "eye contact". MediaPipe is not a gaze estimator: Face Landmarker gives face landmarks, blendshapes and transformation matrices, and iris landmarks do not by themselves say where a person is looking, so N2 is a task-specific classifier the team trains and evaluates. |

Main contribution (wording fixed by the owner): "การพัฒนาและประเมินแบบจำลองจำแนกพฤติกรรมมือและทิศทางการมองเทียบแนวกล้องแบบแยกผู้พูด พร้อมหลักฐานตามช่วงเวลา เพื่อใช้สร้างคำแนะนำในการฝึกซ้อมนำเสนอ"

Pretrained MediaPipe models are **feature extractors**. The team's own work is: annotation protocol,
task-specific features, classifiers, experimental design, baselines/ablations, evidence aggregation and
coaching interpretation. Training a classifier on MediaPipe outputs is **not** fine-tuning; fine-tuning
means changing pretrained weights and is out of scope.

## 2. Label spaces (target)

**N1 mandatory (one per span, mutually exclusive):** `GESTURE` · `REST_OR_HOLD` · `ADAPTOR_MANIPULATION` · `UNOBSERVABLE`
**N1 context flags (any number):** `holding_notes` · `one_hand_hidden` · `repetitive`. Ambiguity is recorded once, as the required `ambiguous` true/false field on every span (N1 and N2), not as a flag.
**N1 intensity:** continuous features always (motion energy, amplitude, velocity, spatial extent); `LOW/MODERATE/HIGH` is an optional human label kept only if the median of the three pairwise quadratic-weighted Cohen's κ in the pilot is ≥ 0.70.
**N1 exploratory, human-only:** `MESSAGE_SUPPORTING` · `POTENTIALLY_DISTRACTING` · `UNCERTAIN` — AI never pre-labels these; usable for modelling only if κ ≥ 0.70, enough independent speakers per class, and expert-reviewed definitions; otherwise exploratory/descriptive only.
**N2 (one per span):** `CAMERA_REGION` · `NOTES` · `OTHER` · `UNOBSERVABLE`. Glance/reading durations are stored as continuous values; no 2 s / 5 s rule is final before the pilot and the expert-reviewed rubric.

Value judgements: `REST_OR_HOLD` is not bad; more `GESTURE` is not better; `repetitive` is not bad by itself.

## 3. Data roles

- SC02 DEV: 18 speakers × 12 clips. **P18, P19, P20 (group G09) are project team members** (verified: their project title in `participants.csv` is this project's title). Their clips are for pipeline development, debugging and supplementary analysis only — never primary evaluation.
- Primary evaluation pool: the 15 non-team speakers P02 P03 P04 P05 P06 P07 P08 P10 P11 P12 P13 P14 P15 P16 P17.
- Scenario IDs (S01–S12) are never labels. Annotators and experts do not see them.
- No new video collection until the pilot class-coverage report exists.
- Natural (S01) and induced clips are always reported separately (pooled, natural-only, induced-only). A model is never deployed from pooled or induced performance alone.
- **Repository = protocol, schema and templates. Real mappings, manifests, labels and answer keys are private research data outside git** (vault `Data/Research_Private/`).
- Record roles: GOLD = `independent` (raw, immutable) or `consensus` (final); SILVER = `reviewed` (after reviewing an AI proposal) or `audit` (blind re-label for anchoring/agreement QA only, never a training label).
- Annotation is **independent, scenario-masked, AI-hidden and peer-label-hidden**. The annotators are team members, not hypothesis-blind (limitation). Expert clip review is blind.

## 4. Gates

| Gate | Rule |
|---|---|
| Annotation agreement | Pilot (purposive items, manual-refinement gate): ≥ 0.70 pass · 0.60–0.69 revise manual and repeat pilot · < 0.60 merge classes, simplify, or drop the optional label. Final GOLD: 100% double-labelled, reliability reported from the complete pre-adjudication records |
| Research success | A correctly designed and reported experiment, including a negative result. Beating a baseline is not required. |
| Deployment | Integrate a model only if it passes evaluation (`EXPERIMENT_PROTOCOL_V1.md` §9). If it does not: show "ข้อมูลยังไม่เพียงพอสำหรับการวิเคราะห์" — **never fall back to legacy N1 v0**. N2 head-only may ship only if it passes validation and its output is renamed to what it measures. |

## 5. Phase 1 prohibitions (this freeze)

No model training, no production labels, no change to `worker/criteria/n1.py`/`n2.py`, `config/thresholds-v0.yaml`,
Result Contract, database, API or UI; no new videos; no contact with experts; no push or merge.

## 6. Legacy status

Legacy N1 (hand-still spans, `n1.py`) is known to be construct-misaligned: on the 8 SC02 rater clips it returned
level 1 or "unanalyzable" on every clip (`data/eval_sc02_v0_9/sc02.md`) because most speakers hold notes.
It stays in production only until Phase 2/3 decides; it is a historical comparison, not a baseline in the new
label space and not a fallback.
