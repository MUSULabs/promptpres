---
doc: research/EXPERIMENT_PROTOCOL_V1
version: v1.1 (Phase 1.2 + 1.2a corrections within D-067, 22 Nov 2026)
date: 2026-11-22
status: OWNER_APPROVED / ADVISOR_REVIEW_PENDING
decisions: D-067
implementation: TARGET DESIGN — no extractor v2, features, labels or models exist yet
owner_approval: approved 2026-11-22
advisor_approval: pending
---

# Experiment protocol v1.1 — N1/N2 (speaker-disjoint)

Tags used below: **[SRC]** supported by a verified source (vault `SOURCE_TABLE.md`) · **[DES]** project design decision · **[PILOT]** value pending the annotation pilot · **[EXPERT]** value pending expert review.

## 1. Research questions

- **RQ-N1:** Can a classifier trained on task-specific landmark features separate `GESTURE`, `REST_OR_HOLD`, `ADAPTOR_MANIPULATION` (and `UNOBSERVABLE`) on unseen speakers better than a pre-defined heuristic? [DES]
- **RQ-N2:** Do eye features (iris position, eyelid openness, eye blendshapes) improve `NOTES` vs `CAMERA_REGION` vs `OTHER` on unseen speakers compared with head pose only? [DES]
- **RQ-AGG:** How well do clip-level summaries aggregated from window predictions match clip-level summaries from GOLD labels? [DES]

A correctly designed and reported negative answer counts as a research result.

## 2. Data and speaker roles

| Role | Speakers | Use |
|---|---|---|
| Primary pool | P02 P03 P04 P05 P06 P07 P08 P10 P11 P12 P13 P14 P15 P16 P17 (15, non-team) | nested LOSO evaluation (§3) |
| Team (G09) | P18 P19 P20 | pipeline development, debugging, supplementary analysis; extra training data may be tested as a separate ablation; **never in a reported primary metric** |

- Scenario IDs never act as labels or features. Natural (S01) and induced (S02–S12) clips are reported separately. [DES]
- P02, P03 and P04 recorded at about 22–23 fps (36 clips, 1280×720). In the 30 fps MP4 about a third of consecutive frames are duplicates. Motion features must use the real frame timestamps of the original WebM, or resample to a fixed grid of at most 10 fps. Results are also reported with and without these three speakers, because resolution and frame rate are confounded with speaker. [DES, from the read-only audit of 22 Nov 2026]
- Which clips and windows enter GOLD is decided by rule before any model runs (§5). It is never moved to where a model does better.

## 3. Split: nested Leave-One-Speaker-Out

- **Outer loop:** 15 folds, each leaves one primary-pool speaker out as test. [DES] Reason: with 15 speakers a fixed held-out set of 3–4 speakers gives very unstable estimates and wastes rare-class examples. LOSO uses every speaker once as unseen test while keeping speakers disjoint.
- **Inner loop:** within the 14 training speakers, GroupKFold by speaker (k = 7, two speakers per fold) for hyperparameter and window-length selection. [DES]
- All windows, frames and clips of one speaker sit in the same fold. Overlapping windows are never split across folds.
- Feature normalisers, class weights, calibration and per-speaker baselines are fitted inside the training part of each fold only. A per-speaker baseline used at test time (e.g. N2 median head pitch) is computed from that test speaker's own unlabeled frames only, never from labels.
- **Frozen before the outer loop runs:** the feature list, model families, hyperparameter grids, window candidates (1/2/3 s, hop 0.5 s) and metrics in this file. Any change after the first outer-loop result = a new protocol version, reported as such.
- Team clips: report a separate "team" table, never pooled.

### 3.1 What may enter training (frozen)

1. The **primary** LOSO experiment trains on **GOLD from the outer-training speakers only**.
2. Inner-validation and outer-test metrics always use **GOLD** (adjudicated consensus records, §4.2).
3. **SILVER augmentation is a separate ablation**, never part of the primary result. It uses SILVER `reviewed` records only; SILVER `audit` records (blind re-labels) are QA evidence for anchoring/agreement and never a training label.
4. SILVER from the outer-test speaker never enters training, calibration, feature selection or proposer fitting for that fold.
5. A **learned** SILVER proposer is fitted inside the fold, on the training speakers only.
6. A **fixed rule-based local proposer** may be used across folds only if it is frozen (rules and thresholds versioned) before any evaluation.
7. Team-speaker data (P18–P20) is a separate ablation and never enters a primary metric.

## 4. Annotation workflow and reliability (before modelling)

**Masking (precise wording).** GOLD annotation is **independent, scenario-masked, AI-hidden and peer-label-hidden**: annotators do not see the scenario name or command, any system or AI output, or each other's labels, and work from masked media files named by `blind_id`. The three annotators are project members, so they are **not blind to the research hypothesis** and may recognise some recordings or speakers. This is reported as a limitation. (The expert clip review in `EXPERT_MICROVALIDATION_V1.md` can be called blind: experts receive no mapping, team label or scenario.)

### 4.1 Pilot (manual-refinement gate)

| Item | Rule |
|---|---|
| Items | 15 items listed in the **private** pilot manifest (outside git; the repository holds only `manifests/pilot_manifest_TEMPLATE.csv`). Items were chosen **purposively for codebook coverage** (visual conditions and expected difficulty), so pilot κ is **not** a population reliability estimate. |
| Who | all 3 members independently (A1, A2, A3) |
| Categorical layers | Fleiss' κ (3 raters) on 0.5 s bins, per layer; plus per-class agreement (one-vs-rest κ between raters), confusion matrix, boundary agreement (onset within ±0.5 s and ±1.0 s), counts of `ambiguous` and `UNOBSERVABLE` [DES] |
| Ordinal `N1_intensity` | **pairwise quadratic-weighted Cohen's κ** for A1–A2, A1–A3 and A2–A3; all three are reported with their **median**. The pilot gate uses the median. Computed on bins where both raters of the pair gave an intensity label. Bins where only one of the pair gave one (because their `N1_function` labels differ) are counted and reported, not imputed. [DES] |
| Gate | ≥ 0.70 pass · 0.60–0.69 revise manual, repeat pilot on new items · < 0.60 merge/simplify/drop optional label. [DES; the 0.70 bar matches the per-code kappa > 0.7 target in Pesch & Lumeng 2017 [SRC]] The pilot κ is used **only to refine the manual**; it is not the reported reliability of the dataset. |
| Pilot labels afterwards | If the manual changes after the pilot, pilot labels are either **re-labelled independently with the final manual** or **excluded** from model training and evaluation. They never enter GOLD under an older manual version. |

### 4.2 Final GOLD (after the manual is locked)

1. **Every** assigned GOLD item is labelled by **2 independent annotators** (100% double labelling). The often-cited **20–30% double coding is a common minimum** (Pesch & Lumeng 2017 [SRC]); this project deliberately double-labels **all** GOLD [DES].
2. Independent records (`record_role = independent`) are **immutable** once submitted.
3. The third member adjudicates disagreements by creating a **new** record (`record_role = consensus`, `consensus_basis = adjudicated`, `adjudicator_id`, `source_annotation_ids`). Spans where both annotators agree get a consensus record with `consensus_basis = agreed`. Adjudication **never overwrites** A1/A2 raw records.
4. **Agreement is computed only from pre-adjudication independent records.** Final dataset reliability (Cohen's κ per layer; quadratic-weighted Cohen's κ for intensity) is computed over the **complete** set of pre-adjudication GOLD records and reported separately from the pilot κ.
5. Model training and evaluation truth = the **adjudicated consensus records**.

### 4.3 From spans to 0.5 s bins (used for every κ)

- Time base: seconds from 0 of the masked media file (§4.4). The reviewed segment `[reviewed_from, reviewed_to)` is cut into bins `[reviewed_from + 0.5k, reviewed_from + 0.5(k+1))`.
- Spans are half-open `[start_s, end_s)`. A bin takes the label that covers **the largest share of the bin**. **Tie rule:** if two labels cover equal time, the bin takes the label of the span that contains the bin's midpoint (with half-open spans the midpoint belongs to exactly one span).
- A final partial bin shorter than 0.25 s is dropped; one of 0.25 s or longer is kept.
- A bin is "ambiguous for a rater" if its assigned label comes from a span with `ambiguous = true`. Primary κ uses all bins; a sensitivity κ excluding bins ambiguous for any rater is also reported.
- Model windows (§7) use the same half-open convention: a window's label is the class covering **more than 50%** of the window, otherwise `transition` (excluded).

### 4.4 One operational time system

1. Annotators label time **relative to the masked media file they actually see, starting at 0**. They never enter timestamps relative to an original WebM they cannot see.
2. The private manifest stores, per `blind_id`, the source clip id, the exact `source_offset_s` (where the masked file starts in the source) and `source_end_s`.
3. After annotation, the custodian joins the private manifest and derives canonical source times: `source_start_s = source_offset_s + start_s`, `source_end_s = source_offset_s + end_s`.
4. Invariant: `0 <= start_s < end_s`, and `end_s` is not beyond the masked media duration.
5. JSON Schema cannot compare two fields, so a **semantic validator must enforce timestamp ordering (and the other rules in `LABEL_PROVENANCE_V1.md` §6) before the first pilot labels are accepted.** No cut media or real offsets are created in Phase 1.

### 4.5 Class coverage report

| Item | Rule |
|---|---|
| Class coverage report | per class: number of GOLD seconds and number of independent primary-pool speakers with ≥ 1 span. A class with < 5 speakers cannot be evaluated speaker-disjointly with useful precision → merge or report as descriptive only [DES; "at least 5 speakers per class" is a **pilot gate set by the project**, not a general statistical rule; it may change depending on whether the outer LOSO folds are feasible for that class] |

## 5. GOLD sampling (pilot proposal for S01; other rules as stated)

1. S01 clips — **PILOT SAMPLING PROPOSAL — NOT FINAL.** For the pilot only, label one window of 60 s starting at 30 s after speech onset (inside the 30–90 s detail window allowed by the SC02 label schema), chosen before any system runs. [DES] Its purpose is to keep pilot workload under control; it must not become the final sampling rule by default.
   - **Check during the pilot:** review at least 3–5 S01 clips in full and record whether this window misses behaviour that appears in the introduction, the middle or the conclusion (for example note-reading only at the start, or hand adaptors only near the end).
   - **Phase 2 comparison (at least):** (a) the fixed 30–90 s window; (b) stratified early / middle / late windows of equal total length.
   - **Final choice** is made from three things recorded per method: coverage of the behaviours seen in the full-clip check, class distribution (seconds and speakers per class), and labelling time per clip. The choice and the numbers go into the decision log before full GOLD labelling starts.
2. Other clips: full clip. Which induced clips are labelled: all clips of the scenarios whose content gives N1/N2 variety (S06–S09, S12) for every primary-pool speaker, plus S02–S05 for N2 only. [DES] The scenario name is used here **only for sampling coverage**, never as a label.
3. Target size: about 2 hours of video per layer; workload is checked after the pilot. [PILOT]
4. Every GOLD item is labelled by 2 independent annotators and adjudicated as in §4.2 (100% double labelling; 20–30% is only the common minimum).

## 6. Features (Phase 2, from a new local extractor; MediaPipe models are fixed feature extractors)

**N1:** shoulder, elbow, wrist and hand landmarks; normalisation by shoulder width and a torso origin (removes body sway); hand-to-body, hand-to-face and inter-hand distance; velocity, acceleration, jerk (from real timestamps); spatial extent; active-hand count; symmetry; motion energy; moving/still ratio; landmark visibility; notes-holding cue (hand pose near the other hand at chest height). Optional ablation: speech activity in the window (VAD) and audio energy. Semantic gesture–speech matching is out of scope.

**N2:** yaw, pitch, roll; pitch/yaw relative to the speaker's own baseline (optional calibration ablation); eye-corner-normalised iris coordinates; eyelid openness (eye aspect ratio); eye blendshapes `eyeLookDown/Up/In/Out`; face scale; face visibility/confidence; face-region illumination; temporal smoothing. MediaPipe is **not** a gaze estimator. Face Landmarker gives face landmarks, blendshapes and facial transformation matrices (Google, Face Landmarker guide [SRC]); Google's MediaPipe Iris announcement states that iris tracking does not infer where people are looking (Vakunov & Lagun, Google Research blog, 6 Aug 2020 [SRC]). These outputs are input features only. `CAMERA_REGION` / `NOTES` / `OTHER` is therefore a **task-specific classifier that the team trains and evaluates itself** against human GOLD labels.

## 7. Models and comparisons (smallest set that answers the RQs)

| Task | Baselines (same label space) | Learned models | Ablations |
|---|---|---|---|
| N1 function | (a) majority class; (b) pre-defined heuristic: `UNOBSERVABLE` if neither hand visible, `ADAPTOR_MANIPULATION` if a wrist is within *d* of the face/other hand while moving, `GESTURE` if wrist speed above *v* and wrist above the waist line, else `REST_OR_HOLD` — *d*, *v* fixed from the inner folds | multinomial logistic regression; gradient-boosted trees (LightGBM) on window features | position-only vs position+dynamics; ± speech features; optional small 1D-CNN/GRU (COULD) |
| N2 | legacy v0 yaw/pitch rule mapped to the 4 labels (front→`CAMERA_REGION`, down→`NOTES`, side/up→`OTHER`, no face→`UNOBSERVABLE`) | head-only GBT; head+eye GBT | ± per-speaker calibration |
| Both | — | — | SILVER augmentation (§3.1, separate ablation) · team-speaker data (separate ablation) |

- Legacy N1 v0 (hand-still spans) outputs a different kind of value. It is reported only as a historical comparison (e.g. how its still spans overlap GOLD `REST_OR_HOLD`), never as a macro-F1 against the 4-class space.
- Class imbalance: class weights; no synthetic oversampling.
- Probability calibration (isotonic or Platt, inside folds).
- **`UNOBSERVABLE` is a real, human-labelled class** (visual evidence unavailable). **Low model confidence is not `UNOBSERVABLE`.** Windows whose top calibrated probability is below a threshold chosen in the inner folds get the prediction-only state **`ABSTAIN_LOW_CONFIDENCE`**, which never appears in labels. Research outputs keep the reason (abstention vs predicted `UNOBSERVABLE`); the user-facing card may translate abstention to "ข้อมูลยังไม่เพียงพอสำหรับการวิเคราะห์".
- Reproducibility: fixed seeds; feature-set hash, model file hash, protocol version and manual version stored with every result.
- Inference cost: classifiers are small tabular models (milliseconds per clip on CPU). The cost of the pipeline stays dominated by landmark extraction (~0.6 s per second of video on the GTX 1650, `PERFORMANCE.md`).

## 8. Metrics and uncertainty

- **Window level:** macro-F1 (primary), per-class precision/recall/F1, balanced accuracy, confusion matrix. **Primary metrics use the 4-class argmax prediction on all eligible GOLD windows, before any rejection.** Windows labelled `ambiguous` or `transition` are not eligible; they are excluded and counted.
- **Selective prediction (for the deployment threshold):** additionally report coverage (share of windows not abstained), abstention rate, and macro-F1 / per-class F1 on the covered windows at that threshold.
- **Event level:** event/boundary F1 for `NOTES` and `ADAPTOR_MANIPULATION` spans (onset match within ±1.0 s [DES]).
- **Clip level:** absolute error of the time share of each class; error of `longest_notes_s` and `notes_events_per_min`; Spearman ρ between predicted and GOLD summaries.
- **Speaker level:** every metric per outer-fold speaker; report median and range, not only the pooled value.
- **Uncertainty:** cluster bootstrap over speakers (resample speakers, 2,000 replicates) for 95% intervals; model differences by paired cluster bootstrap on the same windows. Overlapping windows are never treated as independent samples.
- **Natural vs induced (always):** every main result is reported three ways: pooled, **natural-only (S01)** and induced-only (S02–S12). Natural and induced clips are never merged into one claim about real use.
- **Other breakdowns:** holding notes vs not; dark face (face-region mean grey < 60, audit definition) vs not; 720p/low-fps speakers vs others; occlusion flags.
- No accuracy target is set in advance. Results are judged against the baselines, their intervals and the inter-rater agreement ceiling.

## 9. Deployment gate (separate from research success)

A model may replace a production card only if, on the primary pool:
1. the **lower bound of the 95% paired speaker-cluster bootstrap interval for (model macro-F1 − baseline macro-F1) is above 0** (baseline = the pre-defined heuristic of §7), **and**
2. no class that the card reports has per-class F1 below a floor fixed in Phase 2 before the outer loop **[PILOT]**, **and**
3. the clip-level summaries it reports have an error the experts accept for the rubric **[EXPERT]**, **and**
4. checks 1–3 also pass on **natural rehearsal data (S01) separately**. A model never passes from pooled or induced performance alone. If a class lacks adequate natural-speaker coverage, that limitation is reported and that class (or the model) is not deployed yet. This does not trigger new recording now; targeted new clips are considered only after the pilot class-coverage report.

At the chosen abstention threshold, coverage, abstention rate and performance on covered windows are reported with the gate result.

If N1 fails: the card shows "ข้อมูลยังไม่เพียงพอสำหรับการวิเคราะห์" — **never legacy N1 v0**. If N2 head+eye fails but head-only passes: ship head-only renamed to what it measures (head direction relative to the camera). If both fail: "ข้อมูลยังไม่เพียงพอสำหรับการวิเคราะห์".

## 10. Clip-level rubric (target, values pending)

Window predictions are aggregated into clip summaries (`gesture_pct`, `rest_or_hold_pct`, `adaptor_pct`, `hands_observable_pct`, `repetitive_s`, continuous intensity statistics; `camera_region_pct`, `notes_pct`, `other_pct`, `longest_notes_s`, `notes_events_per_min`, `face_or_eye_visible_pct`). Level descriptors 1–4 come from the expert-reviewed rubric **[EXPERT]**; numeric bounds come from expert review plus human clip ratings **[PILOT/EXPERT]**. Sample percentiles may describe the data but never define good or bad behaviour on their own.
