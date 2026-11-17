# contracts/

`result.schema.json` = Result Contract (version in `contract_version`, mirrored by `promptpres_shared/contract.py`
(Pydantic) and `web/src/contract.ts`). `mocks/` = three example results the web shows without the worker;
their levels follow `config/thresholds-v0.yaml` and their value keys are the ones the real criteria emit
(checked by `worker/tests/test_config.py`).

Two rules JSON Schema cannot express are enforced only by the Pydantic model:
- the 8 criteria have 8 **different** codes;
- every evidence item has `end_s >= start_s`.

Version 1.3 (15 Nov 2026, D-050) adds the optional evidence `label` (S3 writes `เสียงเติม "เอ่อ"` or
`คำติดปาก "แบบว่า"`); stored 1.1 and 1.2 results are upgraded when read.

Version 1.2 (15 Nov 2026, D-046) adds `kind` (strength / focus / plan) to coach items; a focus item must name a
criterion and cite at least one time. A stored 1.1 result is upgraded when it is read (`upgrade_result()` inside
`validate_result()`): the version is renamed and any old coach item becomes `focus`. No version has a total
score or a grade.

`worker/pipeline.validate()` and the API run both checks (schema + Pydantic) before a result is saved or
served, so such a result is still rejected (`api/tests/test_contract.py`). `created_at` is checked as a
real date-time only when `rfc3339-validator` is installed (it is in `api/requirements.txt`).
