---
doc: research/forms/expert_form_spec_v1
version: v1.1 (Phase 1.2 corrections, 22 Nov 2026)
date: 2026-11-22
status: OWNER_APPROVED / ADVISOR_APPROVED — form not built, not sent (send after the annotation pilot)
decisions: D-067
implementation: TARGET DESIGN — build after the pilot fills the item segments
owner_approval: approved 2026-11-22
advisor_approval: approved 2026-11-22 (project title unchanged)
items: expert_items_v1.csv (no answers, no difficulty slot) · answer key: private research artifact outside this repository (template: expert_answer_key_TEMPLATE.csv)
---

# Expert form specification v1.1 (Google Form or equivalent)

Estimated completion time: **13–15 minutes** (see `../EXPERT_MICROVALIDATION_V1.md`). One response per expert (E1–E5); collect the expert code, not the name, in the response sheet.

## Section 0 — คำชี้แจง (ข้อความที่แสดงจริง)

> แบบประเมินนี้ใช้เวลาประมาณ 15 นาที มี 2 ส่วน
> ส่วนที่ 1: ประเมินความสอดคล้องของนิยามและข้อความ 5 ข้อ (+1 สอดคล้อง / 0 ไม่แน่ใจ / −1 ไม่สอดคล้อง)
> ส่วนที่ 2: ดูคลิปสั้น 16 คลิป คลิปละ 8–20 วินาที แล้วเลือกคำที่ตรงกับสิ่งที่เห็นมากที่สุดตามนิยามด้านล่าง ไม่มีคำตอบที่ถูกหรือผิด เราต้องการทราบว่านิยามชัดพอให้ผู้เชี่ยวชาญเลือกตรงกันหรือไม่
> ถ้าภาพไม่พอให้ตัดสิน (เช่น มองไม่เห็นมือ หรือมองไม่เห็นหน้าและตา) ให้เลือกตัวเลือก "มองไม่เห็น…" ของข้อนั้น ถ้าเห็นภาพแต่ตัดสินไม่ได้ให้เลือก "ไม่แน่ใจ"
> คลิปเป็นข้อมูลที่ผู้เข้าร่วมยินยอมให้ใช้ในโครงงาน กรุณาไม่ดาวน์โหลดหรือส่งต่อ

Then a one-page definition card (copied from the manual §1.2 and §2.2 tables, examples included).

## Section 1 — IOC addendum

Five items A1–A5 exactly as in `EXPERT_MICROVALIDATION_V1.md` F1. Each: scale +1 / 0 / −1 (required) + comment (optional). Attach the draft level descriptors for A3 and three example recommendations for A4 (from manual §5, "allowed" column).

## Section 2 — Clip review

- 16 questions in `form_position` order; each shows one embedded view-only video `Qnn.mp4` and the question:
  - N1 item: "ในคลิปนี้ มือของผู้พูดส่วนใหญ่อยู่ในลักษณะใด"
  - N2 item: "ในคลิปนี้ ผู้พูดมองไปทางใดเป็นส่วนใหญ่"
- Options (single choice, required): the four classes of that criterion shown with their Thai names, plus one abstention option "ไม่แน่ใจ". No "ข้อมูลไม่เพียงพอ" option (that is the `UNOBSERVABLE` class).
  - N1: ท่าประกอบการพูด (GESTURE) · พักมือหรือถือโน้ต (REST_OR_HOLD) · สัมผัสตัวหรือเล่นสิ่งของ (ADAPTOR_MANIPULATION) · มองไม่เห็นมือ (UNOBSERVABLE)
  - N2: บริเวณกล้อง (CAMERA_REGION) · โน้ต (NOTES) · ทางอื่น (OTHER) · มองไม่เห็นหน้าหรือตา (UNOBSERVABLE)
- Optional: confidence 1–3 (1 = เดา, 3 = แน่ใจ).
- Never show: scenario name or code, clip/participant id, the team's label, any AI or system output, the difficulty slot.

## Do / don't

| Do | Don't |
|---|---|
| "เลือกคำที่ตรงกับสิ่งที่เห็นมากที่สุด" | "ทีมติดป้ายว่า GESTURE ถูกต้องหรือไม่" |
| Same option order for every item of a criterion | Reorder options per item (adds noise) |
| Pilot-time the form with a member who did not pick the segments | Send before timing it |

## Clip access

View-only links from the restricted drive for the five experts, download disabled, expiry after the review window; files named `Q01.mp4`–`Q16.mp4`. Cut copies only; originals in `Data/` are never modified. Confirm consent coverage for expert viewing before sharing. No clip is uploaded to any AI service.

## Outputs after collection

`responses.csv` (expert code, A1–A5 scores and comments, Q01–Q16 choice + confidence) → join with the private answer key by `form_position` (done by the custodian, outside this repository) → analysis in `EXPERT_MICROVALIDATION_V1.md`.
