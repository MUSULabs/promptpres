---
doc: research/README
version: v1.0
date: 2026-11-22
status: OWNER_APPROVED / ADVISOR_REVIEW_PENDING
decisions: D-067
implementation: TARGET DESIGN — nothing in this folder is implemented in the pipeline yet
owner_approval: approved 2026-11-22
advisor_approval: pending
---

# research/ — N1/N2 research protocol (Scope Freeze v1.0)

This folder is the **repository authority** for the executable parts of the N1/N2 research: the annotation
schema, the annotation manual version used with the data, the experiment protocol, manifests and label
provenance rules. Project scope, decisions, plan and thesis narrative live in the vault
(`Knowledge/01_Project/SCOPE_FREEZE_V1.md`, `Knowledge/00_Control/DECISIONS.md` D-067).

**CURRENT IMPLEMENTATION** = Spec v2.4 legacy N1 (hand-still spans) and N2 (head yaw/pitch rule) in
`worker/criteria/n1.py`, `n2.py`. **FROZEN TARGET** = the designs in these files. The legacy N1/N2 is not
a production fallback for the target design (see `SCOPE_FREEZE_V1.md` §6).

| File | What it fixes |
|---|---|
| [SCOPE_FREEZE_V1.md](SCOPE_FREEZE_V1.md) | Label spaces, gates, prohibitions (summary; vault is authority for scope) |
| [ANNOTATION_MANUAL_N1_N2_V1.md](ANNOTATION_MANUAL_N1_N2_V1.md) | How people label N1 and N2, decision rules, edge cases |
| [LABEL_PROVENANCE_V1.md](LABEL_PROVENANCE_V1.md) | GOLD_MANUAL vs SILVER_ASSISTED, provenance fields, AI pre-annotation rules |
| [EXPERIMENT_PROTOCOL_V1.md](EXPERIMENT_PROTOCOL_V1.md) | Speaker roles, nested LOSO, baselines, metrics, deployment gate |
| [EXPERT_MICROVALIDATION_V1.md](EXPERT_MICROVALIDATION_V1.md) | IOC addendum + blind forced-choice clip review (10–15 min) |
| [schemas/n1_n2_labels_v1.schema.json](schemas/n1_n2_labels_v1.schema.json) | One annotation record (JSON Schema 2020-12) |
| [manifests/pilot_manifest_TEMPLATE.csv](manifests/pilot_manifest_TEMPLATE.csv) | Column template with one invented row. The real 15-item pilot manifest is **private research data outside git** |
| [tests/test_n1_n2_label_schema.py](tests/test_n1_n2_label_schema.py) | Schema test matrix: `python -m pytest research/tests -q` |
| [forms/expert_items_v1.csv](forms/expert_items_v1.csv) | 16 expert item slots (segments chosen after the pilot) |
| [forms/expert_answer_key_TEMPLATE.csv](forms/expert_answer_key_TEMPLATE.csv) | Column template with one made-up row. The real key is a **private research artifact outside this repository** (git-ignored) |
| [forms/expert_form_spec_v1.md](forms/expert_form_spec_v1.md) | Form layout, Thai instructions, timing, clip access |

**This repository holds protocol, schema and templates only. Real mappings, manifests, labels and answer keys are private research data kept outside git** (vault `Data/Research_Private/`, git-ignored; `.gitignore` also catches real files under `research/manifests/` and `research/labels/`). Review bundles must not contain real clip IDs, participant IDs, scenario mappings, media paths, behavioural audit notes or expected difficulty.

CSV files start with `#` metadata lines; read them with `pandas.read_csv(path, comment="#")`.
No video, label or answer from a real clip may be committed here (CLAUDE.md rule 7); the CSVs hold IDs and
rules only.
