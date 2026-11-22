---
doc: research/LABEL_PROVENANCE_V1
version: v1.1 (Phase 1.2 + 1.2a corrections within D-067, 22 Nov 2026)
date: 2026-11-22
status: OWNER_APPROVED / ADVISOR_APPROVED
decisions: D-067
implementation: TARGET DESIGN — no labels or AI proposal tool exist yet
owner_approval: approved 2026-11-22
advisor_approval: approved 2026-11-22 (project title unchanged)
schema: schemas/n1_n2_labels_v1.schema.json
---

# Label provenance v1.1 — GOLD_MANUAL vs SILVER_ASSISTED

## 1. Two tiers that never mix

| | GOLD_MANUAL | SILVER_ASSISTED |
|---|---|---|
| Used for | annotation reliability, model evaluation, every metric reported in chapter 4 | extra training data, development, error analysis |
| AI suggestions | **hidden** from annotators | shown as proposals; a person decides |
| Scenario intent | hidden | hidden |
| Other annotators' labels | hidden while labelling | hidden while labelling |
| `label_source` | `manual` only; every AI provenance field null | `reviewed`: `ai_assisted` for a reviewed proposal, `manual` only for a span the reviewer added (`review_action = added`) · `audit`: `manual`, every AI provenance field null |
| Layers | all layers | `N1_function` and `N2_direction` only |
| Record roles | `independent` (raw, immutable) and `consensus` (new record from ≥ 2 independent records) only | `reviewed` (one reviewer's decision on an AI proposal, or a span they added) and `audit` (a second person's label with the AI proposal and first label hidden; QA evidence for anchoring/agreement only, **never a training label**) only |
| Who | pilot: all 3 members independently; after the manual is locked: **every** GOLD item by 2 independent annotators (100%) + the 3rd adjudicates disagreements by creating consensus records | 1 reviewer; 20–30% re-labelled by a second person with the AI proposal and first label hidden |
| May be a reported result | yes | **no** |

Rules for GOLD:
- Every non-team speaker in the primary pool (15 speakers, see `SCOPE_FREEZE_V1.md` §3) has GOLD samples.
- GOLD/test labels are never created, pre-filled or corrected from the output of the classifier being evaluated, or from any model trained on the same test speakers.
- A span labelled once as SILVER cannot be promoted to GOLD. GOLD for the same span must be labelled again from scratch, with the SILVER label and AI proposal hidden.
- Masking wording: GOLD is **independent, scenario-masked, AI-hidden and peer-label-hidden**. The annotators are project members and are **not hypothesis-blind**; they may recognise some recordings (reported as a limitation).
- Independent records are **immutable**. Adjudication creates a **new** `consensus` record with `source_annotation_ids` (and `adjudicator_id` when `consensus_basis = adjudicated`); it never edits A1/A2 records. Agreement uses only independent (pre-adjudication) records; training and evaluation truth uses consensus records.
- If the manual changes after the pilot, pilot labels are re-labelled independently with the final manual or excluded from model training and evaluation.

## 2. SILVER workflow

1. A proposal tool suggests time spans and an **observable** label (`N1_function`, `N2_direction` only — never `N1_flags`, `N1_intensity` or `N1_exploratory`). A learned proposer is fitted inside each LOSO fold on training speakers only; a fixed rule-based local proposer must be frozen before evaluation (`EXPERIMENT_PROTOCOL_V1.md` §3.1).
2. The reviewer watches the real video and listens to the audio.
3. The reviewer may **accept, modify (label or boundaries), reject (delete), or add** a missed span. A UI with only a "confirm" button is not allowed.
4. 20–30% of SILVER clips are labelled again by a second person with the AI proposal and the first label hidden, stored as `record_role = audit` (manual, no review action, no AI provenance). Agreement between this independent label and the reviewed SILVER label is reported, together with the share of proposals accepted unchanged. A high acceptance rate with low blind agreement is evidence of anchoring on the AI proposal.
5. SILVER never enters a reported metric. **Audit records are QA evidence only**: they are compared with `reviewed` records to measure anchoring and agreement, and never enter training, calibration, feature selection or proposer fitting. SILVER augmentation (`reviewed` records only) is a separate ablation; SILVER from an outer-test speaker never enters training, calibration, feature selection or proposer fitting for that fold.

## 3. Rules for AI pre-annotation

- Never use the scenario ID, scenario command or clip file name as an answer or a feature of the proposal.
- Never use the final model being evaluated to create evaluation truth (GOLD).
- Prefer proposals for **time boundaries and observable behaviour** (e.g. "both hands not detected", "head pitch below the speaker's baseline"), not value judgements.
- Data protection: before any video, frame or transcript goes to an external or cloud AI service, check that the SC02 consent covers third-party processing. **Until that is confirmed in writing, proposals use local/offline features only** (MediaPipe on the GTX 1650, local scripts). This document does not assume the consent covers it.

## 4. Provenance fields (one record per span)

| Field | Required | Meaning |
|---|---|---|
| `annotation_id` | yes | unique id |
| `blind_id` / `clip_id` | `blind_id` yes; `clip_id` custodian copies only | masked media code in the annotator file; the private manifest maps it to the source clip |
| `tier` | yes | `GOLD_MANUAL` or `SILVER_ASSISTED` |
| `record_role` | yes | GOLD: `independent` (one annotator, immutable) or `consensus` (final GOLD record) · SILVER: `reviewed` (after reviewing an AI proposal) or `audit` (blind re-label, QA only) |
| `layer` | yes | `N1_function`, `N1_flags`, `N1_intensity`, `N1_exploratory`, `N2_direction` (no `N2_flags`: its only flag was ambiguity, now the `ambiguous` field) |
| `start_s`, `end_s` | yes | seconds from 0 of the **masked media file** the annotator saw; `0 <= start_s < end_s` |
| `source_start_s`, `source_end_s` | custodian copies only; both or neither | `source_offset_s` (private manifest) + `start_s` / `end_s` |
| `final_label` | yes | label of the span; null only for `N1_flags` records and rejected proposals |
| `flags` | `N1_flags` only (forbidden elsewhere) | `holding_notes`, `one_hand_hidden`, `repetitive` |
| `label_source` | yes | `manual` or `ai_assisted` |
| `proposal_model` | if ai_assisted | e.g. `rule-proposer` or a model name |
| `proposal_model_version` | if ai_assisted | exact version/hash |
| `proposal_prompt_or_rule_version` | if ai_assisted | prompt id or rule file version |
| `proposed_label` | if ai_assisted | what the tool suggested, from the same layer's label set (null for `added`) |
| `review_action` | SILVER `reviewed` only (null on GOLD and `audit`) | `accepted` / `modified` / `rejected` (ai_assisted) or `added` (manual) |
| `reviewer_id` | yes | annotator code (A1, A2, A3), never a name |
| `adjudicator_id` | if `consensus_basis = adjudicated` (null when `agreed`) | annotator code |
| `consensus_basis` | consensus only | `agreed` or `adjudicated` |
| `source_annotation_ids` | consensus only | `annotation_id` of the ≥ 2 independent records it was built from |
| `manual_version` | yes | e.g. `ANNOTATION_MANUAL_N1_N2_V1.0` |
| `created_at` | yes | ISO 8601 timestamp |
| `confidence` | optional | 1–3 |
| `ambiguous` | yes | true/false — the single place ambiguity is recorded (never a flag) |
| `evidence_note` | optional | short text, no personal data |

Rejected proposals are kept as records with `review_action = rejected` and `final_label = null`, so the acceptance rate can be computed. If the reviewer puts a different label on that time, it is a separate `added` record.

`review_action` meanings: **accepted** = proposed label **and** boundaries kept unchanged; **modified** = label or boundaries changed; **rejected** = proposal deleted (`final_label` null); **added** = a span the proposer missed, entered by hand (`label_source = manual`, `proposed_label` null, `final_label` not null).

## 5. Storage

**Repository = protocol, schema and templates. Real mappings, manifests, labels and answer keys = private
research data outside git.** Label files contain IDs and times only, but they describe identifiable people's
behaviour: keep them, the pilot manifest and the expert answer key in the vault's git-ignored
`Data/Research_Private/` (restricted drive), never in this repository. Ignore rules in `.gitignore` catch real
manifests and labels under `research/`; files ending in `_TEMPLATE.csv` stay tracked. Review bundles must not
contain real clip IDs, participant IDs, scenario mappings, media paths, behavioural audit notes or expected
difficulty.

## 6. What the schema checks and what the semantic validator must check

`schemas/n1_n2_labels_v1.schema.json` (Draft 2020-12, tests in `tests/test_n1_n2_label_schema.py`) enforces
every single-record rule it can express: label sets per layer (final and proposed), flags only on `N1_flags`,
non-null `final_label` on labelled layers except rejected proposals, null AI fields on GOLD, record roles per tier
(GOLD `independent`/`consensus`, SILVER `reviewed`/`audit`), SILVER limited to `N1_function`/`N2_direction`,
provenance and a review action required for `reviewed` (`ai_assisted` = accepted/modified/rejected, `added` = manual
with no proposal), `audit` = manual with no review action, no AI provenance and a non-null label, consensus = GOLD
with ≥ 2 `source_annotation_ids`, no `adjudicator_id` on an `agreed` consensus, `source_start_s`/`source_end_s`
both present or both absent.

JSON Schema cannot compare fields or look across records. The **semantic validator** `validate_labels.py` (Phase 2,
tests in `tests/test_validate_labels.py`) must pass before any pilot label is accepted. It rejects:
- `end_s <= start_s`, or `end_s` beyond the masked media duration;
- `accepted` where the final label or boundaries differ from the proposal;
- consensus records whose `source_annotation_ids` do not exist, are not `independent`, are from fewer than two different annotators, or do not overlap the consensus span;
- any edit to an independent record after submission (compare against the stored hash);
- gaps or overlaps of primary labels inside the reviewed segment of one layer (manual §0 coverage rule);
- an `audit`/`reviewed` pair that is compared for anchoring/agreement unless both have the same `blind_id` and `layer`, overlapping time and **different** `reviewer_id`;
- an `agreed` consensus whose `final_label` differs from the `final_label` of any source record, or whose span is not inside the overlap of its sources;
- source times that do not equal `source_offset_s + start_s` and `source_offset_s + end_s` (tolerance 0.001 s) using the private manifest, or `source_end_s` beyond the manifest's `source_end_s`.

How it is run (repository root; real labels, manifest and hash file stay in `Data/Research_Private/`):

```
python -m research.elan_to_records A1_PV01-03.eaf ... -o labels.jsonl --manifest <private manifest>
python -m research.validate_labels labels.jsonl --manifest <private manifest> --hashes <private hashes.json> --record-hashes
```

`--record-hashes` stores the hash of each new independent record only when every check passes; after that an edited
independent record is reported as `edited_after_submit`. Coverage is checked per annotator, clip and primary layer
over the whole masked file (the first and last span may miss the file edge by less than the 0.1 s ELAN resolution);
consensus records are partial and are not coverage-checked. `--proposals` (JSONL of the proposal boundaries) adds
the boundary half of the `accepted` rule for SILVER records, whose own record stores only the final boundaries.
