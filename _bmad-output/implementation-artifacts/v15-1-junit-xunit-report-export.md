# Story V15.1: JUnit/xUnit export of a report

Status: review

Epic: V15 — Follow-through on 0.14 (`_bmad-output/planning-artifacts/v015-epics.md`)
Story Key: `v15-1-junit-xunit-report-export`
Size: S (about half a day)
Depends on: none (builds on the 0.14 CSV/JSON export, V14.3)

## Story

As a CI engineer,
I want to download a report as JUnit/xUnit XML,
so that Jenkins, GitLab or Azure DevOps show RoboScope results in their own test dashboards.

## Acceptance Criteria

1. **AC1:** `GET /reports/{id}/export?format=junit` returns `application/xml` with
   `Content-Disposition: attachment; filename="report_<id>_xunit.xml"`. The body is RF's xUnit output, with a `<testsuite>` root
   whose `tests`/`failures`/`skipped` counts match the report.
2. **AC2 (fixed argv):** the conversion runs
   `[sys.executable, "-m", "robot.rebot", "--output", "NONE", "--log", "NONE", "--report", "NONE", "--nostatusrc", "--xunit", <tmp>/xunit.xml, <output.xml>]`
   as a list inside a `tempfile.TemporaryDirectory()`, with `timeout=120`. Only the DB-stored `output_xml_path` and the temp path
   reach the argv, never request input.
3. **AC3 (seam unchanged):** `build_robot_argv` never emits `--xunit`. `validate_advanced_args` still rejects `--xunit` and `-x`.
4. **AC4 (errors):** an unknown report returns 404. `output_xml_path` empty or not on disk returns 404 "output.xml not found".
   rebot rc ≠ 0 or `TimeoutExpired` returns 422 with `stderr[:500]` (or "conversion timed out"). A bad `format` returns 422 (Literal).
5. **AC5 (auth):** `get_current_user`, same as CSV/JSON.
6. **AC6 (UI):** "Export JUnit" in `ReportDetailView.vue` and `RunDetailPanel.vue` downloads `report_<id>_xunit.xml`.
   On failure, a toast shows the server `detail`.

## Tasks / Subtasks

- [x] Backend (AC1, AC2, AC4)
  - [x] `reports/service.py::render_xunit(output_xml_path: str) -> bytes`. It raises `FileNotFoundError` when the path is missing and `ValueError(msg)` on rc≠0 or timeout.
  - [x] `reports/router.py::export_report_results`: `format: Literal["csv", "json", "junit"]`, and a junit branch that maps the exceptions to 404/422.
- [x] Regression pin (AC3): add a `--xunit`/`-x` rejection case to `tests/execution/test_resolver_advanced.py` (skip it if one already exists; grep first).
- [x] Frontend (AC6)
  - [x] `api/reports.api.ts::exportReportResults`: widen the format union to include `'junit'`.
  - [x] Both views: add a third button. The filename is `report_${id}_xunit.xml` for junit (the current code interpolates `.${format}`, so special-case it).
  - [x] i18n `reportDetail.exportJunit`, `reportDetail.exportJunitFailed` in EN/DE/FR/ES (check both `reportDetail` blocks: `en.ts:656` and `:1069`, and use the one the views read).
- [x] Docs: one sentence in the reports section of `frontend/src/docs/content/{en,de,fr,es}.ts`.
- [x] Tests (see Testing).

## Dev Notes

- **Why rebot in RoboScope's own Python, run as a subprocess:** `robotframework>=7.1` is a backend dependency (`backend/pyproject.toml:26`),
  so it works for uploaded reports, deleted environments and Docker runs, none of which has a usable venv.
  The in-process `robot.rebot()` API mutates RF's global `LOGGER`, which is unsafe in FastAPI's worker threadpool. A stdlib
  generator from `TestResult` rows was rejected because the rows only keep `suite_name` (no hierarchy, no suite
  setup/teardown failures), and it would be a second schema mapping to maintain. Full comparison: `v015-epics.md` V15.1.
- **Seam rule (CLAUDE.md "RF execution config"):** `--xunit` is Z1-owned (`execution/resolver.py:35`, short `-x` in `OWNED_SHORT`).
  This story does **not** touch `build_robot_argv`/`resolver.py`. The rebot argv is a module constant plus two paths, and
  never includes user args or modifiers. Do not pass `--prerebotmodifier`: org prerebot modifiers already ran when
  the run produced `output.xml`.
- **XML safety:** run-produced `output.xml` comes from RF. Uploaded archives are parsed with `defusedxml` at upload
  (`reports/router.py:261`), so entity-laden files are rejected before they are stored.
- `--nostatusrc` makes rc 0 even with failed tests, so rc≠0 means a real conversion error (for example rc 252 for invalid data, or a
  `schemaversion` from a much newer RF).
- The endpoint is a sync `def`, so the blocking `subprocess.run` runs in the threadpool. That is acceptable for a user-triggered download.
- Existing patterns to reuse: the `export_report_results` headers dict and `Response(...)` (`reports/router.py:681-713`), and
  `downloadBlob` in `ReportDetailView.vue:94` / `RunDetailPanel.vue:170`.

### Testing

- `backend/tests/reports/test_export.py` (extend): the fixture builds a real `output.xml` via `subprocess.run([sys.executable, "-m", "robot",
  "--output", out, "--log", "NONE", "--report", "NONE", suite])` on a 1-pass/1-fail suite in `tmp_path`, inserts a `Report` pointing
  at it, and asserts the junit body parses, `failures="1"`, and the filename header. Also: file deleted leads to 404, garbage `output.xml` leads to 422,
  and `subprocess.run` patched to raise `TimeoutExpired` leads to 422.
- `frontend/src/tests/components/ReportExport.spec.ts` (extend): the junit button calls `exportReportResults(id, 'junit')` and the download name ends in `_xunit.xml`.
- **e2e** `e2e/tests/report-export-delete.spec.ts` (extend): upload the fixture, click "Export JUnit", then check the `waitForEvent('download')`
  filename and that `<testsuite` is in the saved file.
- Run `npm run build` (prod i18n check) and `make test-backend-fast`.

### References

- [Source: backend/src/reports/router.py#export_report_results]
- [Source: backend/src/execution/resolver.py#OWNED_FLAGS]
- [Source: CLAUDE.md#RF execution config (Epic EXEC) flows through ONE resolver seam]
- [Source: _bmad-output/planning-artifacts/research/v0.14-functional-gap-brainstorm-2026-09-24.md#G-15]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- The e2e upload fixture (`generator="Robot 7.0"`, no `schemaversion`) was converted with the exact rebot argv
  locally: rc 0, `<testsuite tests="2" failures="1">`, so the e2e assertion holds.

### Completion Notes List

- `render_xunit` runs the fixed AC2 argv via `subprocess.run` (list, `timeout=120`) in a `TemporaryDirectory`.
  Missing path/file raises `FileNotFoundError` (404 "output.xml not found"); rc!=0, missing xunit file or timeout
  raises `ValueError` (422 with `stderr[:500]` or "conversion timed out"). `resolver.py` untouched.
- AC3 pin: `--xunit` and `-x` added to the rejection parametrize (none existed), plus
  `test_build_robot_argv_never_emits_xunit`.
- Frontend: `ReportExportFormat` union + `reportExportFilename()` in `reports.api.ts`, shared by both views.
  `exportReportResults` unwraps a Blob error body into JSON so `extractErrorDetail` gets the server `detail`
  (with `responseType: 'blob'` the error body is a Blob too). Export failures for all three formats now toast.
- **Deviation:** the failure toast key is `reportDetail.exportFailed` ("Export failed"), not `exportJunitFailed`,
  because the same handler covers CSV/JSON failures too. ZH falls back to EN.
- Docs: one sentence appended to the existing export paragraph in EN/DE/FR/ES (no new section ids).
- Tests: backend full suite 2481 passed (`-n auto`); frontend vitest 925 passed (81 files), vue-tsc clean,
  vite build OK. e2e spec extended but not run (per instructions).

### File List

- backend/src/reports/service.py
- backend/src/reports/router.py
- backend/tests/reports/test_export.py
- backend/tests/execution/test_resolver_advanced.py
- frontend/src/api/reports.api.ts
- frontend/src/views/ReportDetailView.vue
- frontend/src/components/execution/RunDetailPanel.vue
- frontend/src/i18n/locales/{en,de,fr,es}.ts
- frontend/src/docs/content/{en,de,fr,es}.ts
- frontend/src/tests/components/ReportExport.spec.ts
- e2e/tests/report-export-delete.spec.ts
- CHANGELOG.md
