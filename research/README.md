---
doc: research/README
version: v1.0
date: 2026-11-22
status: OWNER_APPROVED / ADVISOR_APPROVED
decisions: D-067
implementation: TARGET DESIGN — nothing in this folder is implemented in the pipeline yet
owner_approval: approved 2026-11-22
advisor_approval: approved 2026-11-22 (project title unchanged)
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
| [validate_labels.py](validate_labels.py) | Phase 2 semantic validator (LABEL_PROVENANCE_V1 §6): time order, media and source times, accepted, consensus, immutability, coverage, audit pairs |
| [elan_to_records.py](elan_to_records.py) | Phase 2: ELAN `.eaf` → JSONL records (GOLD independent), then the validator; also writes the template |
| [elan/n1_n2_template_v1.etf](elan/n1_n2_template_v1.etf) | ELAN template generated from `elan_to_records.py` (tiers and vocabularies = the schema label sets) |
| [features/README.md](features/README.md) | Phase 2 local extractor v2: per-frame feature table on a 10 fps grid, column list, versions (draft, locked before the first outer LOSO run) |
| [make_masked_media.py](make_masked_media.py) | Phase 2 custodian tool: cuts `<blind_id>.mp4` copies (no metadata) and writes the private manifest with `source_offset_s` |
| [agreement_report.py](agreement_report.py) | Phase 2: spans → 0.5 s bins, Fleiss/Cohen κ, confusion matrices and class coverage per layer (EXPERIMENT_PROTOCOL_V1 §4.3–§4.5) |
| [forms/expert_items_v1.csv](forms/expert_items_v1.csv) | 16 expert item slots (segments chosen after the pilot) |
| [forms/expert_answer_key_TEMPLATE.csv](forms/expert_answer_key_TEMPLATE.csv) | Column template with one made-up row. The real key is a **private research artifact outside this repository** (git-ignored) |
| [forms/expert_form_spec_v1.md](forms/expert_form_spec_v1.md) | Form layout, Thai instructions, timing, clip access |

**This repository holds protocol, schema and templates only. Real mappings, manifests, labels and answer keys are private research data kept outside git** (vault `Data/Research_Private/`, git-ignored; `.gitignore` also catches real files under `research/manifests/` and `research/labels/`). Review bundles must not contain real clip IDs, participant IDs, scenario mappings, media paths, behavioural audit notes or expected difficulty.

CSV files start with `#` metadata lines; read them with `pandas.read_csv(path, comment="#")`.
No video, label or answer from a real clip may be committed here (CLAUDE.md rule 7); the CSVs hold IDs and
rules only.

## วิธีติดป้าย pilot ใน ELAN (ผู้ติดป้าย A1–A3)

1. ติดตั้ง ELAN จาก The Language Archive (MPI) แล้วเปิด `File → New` เลือกวิดีโอ `<blind_id>.mp4` ที่ผู้ดูแลข้อมูลส่งให้ และเลือกแม่แบบ `elan/n1_n2_template_v1.etf`
2. ติดป้ายตาม [คู่มือ](ANNOTATION_MANUAL_N1_N2_V1.md) ความละเอียด 0.1 วินาที:
   - `N1_function` และ `N2_direction` ต้องมีป้ายต่อกันตลอดคลิปตั้งแต่ 0 ถึงท้ายไฟล์ ไม่มีช่องว่าง ไม่ซ้อนกัน
   - `N1_intensity` และ `N1_exploratory` ติดเฉพาะช่วง `GESTURE` หรือ `ADAPTOR_MANIPULATION` (ไม่บังคับ)
   - flag แต่ละตัวมี tier ของตัวเอง (`N1_flag_holding_notes`, `N1_flag_one_hand_hidden`, `N1_flag_repetitive`) ทับกันได้
   - ช่วงที่ไม่แน่ใจ ใส่ `ambiguous` ใน tier ลูก `<tier>_ambiguous` ของช่วงนั้น · ความมั่นใจ 1–3 ใน `<tier>_confidence` · หมายเหตุสั้นใน `<tier>_note` (ห้ามมีชื่อหรือข้อมูลส่วนตัว)
3. บันทึกเป็น `<รหัสผู้ติดป้าย>_<blind_id>.eaf` เช่น `A2_PV01-07.eaf` แล้วส่งให้ผู้ดูแลข้อมูลทางไดรฟ์จำกัดสิทธิ์
4. ห้ามเปิดไฟล์ของผู้ติดป้ายคนอื่น ห้ามเปิดคลิปต้นฉบับหรือ manifest และห้ามใช้ผลของระบบหรือ AI ระหว่างติดป้าย

ผู้ดูแลข้อมูลแปลงและตรวจด้วย `python -m research.elan_to_records <ไฟล์ .eaf> -o <labels.jsonl> --manifest <manifest ส่วนตัว>` แก้ตามรายการที่ validator แจ้งก่อน แล้วรัน `validate_labels.py ... --hashes <ไฟล์ส่วนตัว> --record-hashes` เพื่อบันทึกว่ารับป้ายแล้ว (หลังจากนี้ห้ามแก้ป้าย independent)
