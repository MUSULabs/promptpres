---
doc: research/EXPERT_MICROVALIDATION_V1
version: v1.1 (Phase 1.2 corrections, 22 Nov 2026)
date: 2026-11-22
status: OWNER_APPROVED / ADVISOR_APPROVED — approved to send after the annotation pilot; not sent yet, experts not contacted
decisions: D-067 (follows D-034 five experts E1–E5, D-040 short IOC)
implementation: TARGET DESIGN — clip segments are chosen only after the annotation pilot
owner_approval: approved 2026-11-22
advisor_approval: approved 2026-11-22 (send to E1–E5 after the annotation pilot, about mid to late December 2026)
files: forms/expert_items_v1.csv · forms/expert_answer_key_TEMPLATE.csv (columns only) · forms/expert_form_spec_v1.md · real answer key = private research artifact, not in this repository
---

# Expert micro-validation v1.1

The five IOC experts (E1–E5) have limited time. They do **not** label the dataset and do **not** watch the 18 S01
clips. One packet of about **10–15 minutes** per person has two parts.

What this validates: clarity of the N1/N2 definitions, anchor examples, content/face validity of the class
names, level descriptors and feedback wording. **What it does not validate:** model accuracy. Micro-validation
results are never presented as proof that a model is accurate.

## F1. IOC addendum (5 items, ~4 minutes)

Same scale and pass rule as IOC v0.9 (−1 / 0 / +1; item passes when the sum of 5 experts ≥ 3, IOC ≥ 0.60;
`config/eval-v0.yaml` `ioc`), so `eval/ioc.py` can score it with an item list.

| Item | Statement the expert rates for congruence |
|---|---|
| A1 | N1 definitions: `GESTURE`, `REST_OR_HOLD`, `ADAPTOR_MANIPULATION`, `UNOBSERVABLE` describe observable hand behaviour during a presentation without judging it. |
| A2 | N2 definitions: `CAMERA_REGION`, `NOTES`, `OTHER`, `UNOBSERVABLE` describe camera-relative visual direction, and the result is not called eye contact. |
| A3 | The clip-level outputs (time shares, longest continuous span, events per minute) are suitable for describing a rehearsal on 4 levels. Level descriptors are attached as a draft. |
| A4 | The example recommendations are appropriate: they state an observation with times, then a practicable action, and do not infer emotion or confidence. |
| A5 | The names and wording of N1 "พฤติกรรมมือระหว่างการนำเสนอ" and N2 "ทิศทางการมองเทียบแนวกล้อง" do not claim more than what is measured. |

Each item has a free-text comment box. The previous IOC v0.9 items for N1/N2 (4 of 16) are reported as
evaluating the legacy definitions; the addendum results are reported as the validity evidence for the target design.

## F2. Blind forced-choice clip review (16 items, ~8–10 minutes)

- 16 short segments of 8–20 s: 8 N1, 8 N2. Per criterion: 4 clear, 3 borderline, 1 insufficient-visual-information. [DES] The insufficient-information slot has `UNOBSERVABLE` as its team consensus class; it is not a separate answer.
- **Segment eligibility (all required):**
  - taken from GOLD labelled with the **final** manual (not pilot-edition labels);
  - the team consensus record exists **before** the segment is selected;
  - one class covers **more than 50%** of the segment, and that class is the consensus answer;
  - mixed or transition segments are excluded, unless deliberately chosen as a borderline item, with the reason written in the private key;
  - primary-pool (non-team) speakers only, at most 2 segments per speaker.
- Order is randomised once per form (seed recorded). The expert never sees the scenario name, the team's label, or any AI output.
- The question asks the expert to **choose** a label from the definitions, never "is the team's label X correct?" (that framing invites confirmation bias).
- Answer options per item: the **4 classes** of that criterion plus **one abstention option, "ไม่แน่ใจ"**. There is no separate "ข้อมูลไม่เพียงพอ" option: insufficient visual information is the class `UNOBSERVABLE`. Optional confidence 1–3.

**Analysis after all answers are in (fixed before collection):**
- "ไม่แน่ใจ" is an **abstention**. Its count per item and per expert is reported.
- **Expert majority** = at least 3 of the 5 experts chose the **same defined class**. An abstention never counts towards a majority. Items with no majority are listed.
- **Fleiss' κ among experts**: computed per criterion with 5 response categories (the 4 classes + "ไม่แน่ใจ"), so every item keeps 5 ratings. This one rule is used throughout. It is reported with the caution that 8 items per criterion give a wide interval.
- **Team vs expert**: percent agreement and a confusion table, computed **only on items that have an expert majority class**. The number of items excluded for having no majority is reported next to it.
- Every item where experts disagree with each other or with the team goes back to the manual as a boundary case or an anchor revision.

## Answer key = private research artifact

The real answer key (`expert_answer_key_v1.csv`: item → form position, difficulty slot, source clip, segment
times, team consensus label) is a **private research artifact**. It is kept only in the vault's git-ignored
`Data/Research_Private/D067/`, is never committed to this repository, never attached to the form, and never
shown to the experts or to the person who builds the form. This repository holds only
`forms/expert_answer_key_TEMPLATE.csv` (column names plus one made-up row) and an ignore rule for
`research/forms/expert_answer_key_v*.csv`. `forms/expert_items_v1.csv` lists form positions, criterion and
answer options only: no difficulty slot, clip/speaker/scenario id or team label.

## Timing estimate

| Part | Minutes |
|---|---|
| Read instructions and definitions (1 page) | 2 |
| F1 addendum, 5 items | 3–4 |
| F2, 16 segments × ~30 s (watch 8–20 s + choose) | 8–9 |
| **Total** | **≈ 13–15** |

Pilot the form once with a team member who did not choose the segments (time it; if over 15 minutes, drop to 12 segments, 6 per criterion, keeping the 4/3/1-ish mix).

## Secure clip access

Segments are cut copies, never the originals in `Data/`. They are shared from the restricted drive with view-only
access for the five named experts, with no download and the link expiring after the review window. File names are
neutral form-position codes (`Q01.mp4` … `Q16.mp4`). Before sharing, confirm that each speaker's SC02 consent covers viewing by the
named experts (the consent already covers expert raters for `RATERS_S01_blind`; check it covers short segments
from other scenarios too). No clip goes to any external AI service.
