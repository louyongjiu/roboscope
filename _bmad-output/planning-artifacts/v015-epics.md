---
status: 'draft'
createdAt: '2026-09-25'
inputDocuments:
  - _bmad-output/planning-artifacts/v014-epics.md
  - _bmad-output/planning-artifacts/research/v0.14-functional-gap-brainstorm-2026-09-24.md
  - _bmad-output/planning-artifacts/flow-editor-followups/FE-ENV-environment-variables.md
  - CHANGELOG.md (0.14.0)
epic: 'V15 — Follow-through on 0.14 (v0.15.0)'
---

# RoboScope — Epic V15: Follow-through on 0.14

## Overview

0.14.0 made schedules fire, injected environment variables into runs, and added CSV/JSON
export. V15 finishes the work next to those features: JUnit export for CI dashboards, a
Flow Editor warning when `%{NAME}` is not defined in the repo's environment, and a
cleanup of the run options that the API accepts but ignores. Saved run templates stay a
decision that depends on user feedback. Each implementable story takes well under a day.
Each one covers backend, frontend, i18n (EN/DE/FR/ES; ZH falls back to EN) and tests.

**Suggested order:** V15.1, V15.2 and V15.3 are independent. Only V15.3 touches
`execution/tasks.py`. V15.4 is not implemented in this iteration. It only asks the question
to users (see the gate).

**Story files:**
`_bmad-output/implementation-artifacts/v15-1-junit-xunit-report-export.md`,
`v15-2-flow-editor-env-var-definition-check.md`, `v15-3-inert-run-options-retry-and-parallel.md`,
`v15-5-custom-dockerfile-and-image.md`.

## Cross-cutting rules (from CLAUDE.md, apply to every story)

- `db.commit()` before `dispatch_task()`. Task modules import FK models (`import src.auth.models  # noqa: F401`).
- Every user-facing string goes in `frontend/src/i18n/locales/{en,de,fr,es}.ts`. Escape `@ | { }`, and in
  particular the `%{…}` literals in V15.2 must be written as `%{'{'}NAME{'}'}`. Verify with a prod build (`npm run build`).
- **EXEC resolver seam:** `build_robot_argv()` is the only builder of `robot` argv. V15.1's post-hoc `rebot` call
  is not a run and has no user input. `--xunit` stays in `OWNED_FLAGS` and is never accepted from advanced args.
- **Advanced-config writers:** anything that writes `ExecutionRun.advanced_config` outside `start_run` must route through
  `gate_advanced_execution`. V15.3's auto-retry therefore never copies it (see V15.3 AC4).
- FlowEditor: never mutate `props.form` from display-only code (deep-watcher reset trap). E2e fixtures must have at least 2 test cases.
- Offline only: no new runtime dependencies. Robot Framework (`robotframework>=7.1`) is already a backend dependency.
- The in-app docs (`frontend/src/docs/content/{en,de,fr,es}.ts`) must describe the real behaviour. Top-level section ids stay identical (Gate 8).

---

## Story V15.1: JUnit/xUnit export of a report

**As a** CI engineer, **I want** to download a report as a JUnit/xUnit XML file, **so that** Jenkins, GitLab
or Azure DevOps can show RoboScope results in their own test dashboards.

**Evidence:** `reports/router.py:681 export_report_results` accepts only `csv|json`. `--xunit` is Z1-owned
(`execution/resolver.py:35`) and is never emitted, so no run produces an xunit file today.

### Option evaluation (recommendation: A)

| | A. `rebot --xunit` post hoc, RoboScope's own Python | B. `rebot` in the environment's venv | C. stdlib XML from `TestResult` rows |
|---|---|---|---|
| Works for uploaded reports / deleted envs / docker runs | yes (`sys.executable`, RF is a backend dep) | **no**: uploads have no env, and envs get deleted | yes |
| Fidelity | RF's own xUnit (suite tree, suite setup/teardown failures, skips) | same | lossy: `TestResult` keeps only `suite_name`, no hierarchy and no suite-level failures |
| Maintenance | a fixed argv, no mapping code | venv resolution plus the same argv | a second hand-maintained schema mapping |
| Risk | a very new/old `output.xml` schema can fail to parse → 422 | the same, plus a missing venv | none |

**A** it is. Run it as a subprocess (`[sys.executable, "-m", "robot.rebot", …]`), not with in-process `robot.rebot()`.
RF's global `LOGGER` state is not safe to share with API worker threads. The input `output.xml` is either
produced by RF or was accepted by the upload path, which already parses it with `defusedxml`
(`reports/router.py:261`).

### Acceptance criteria

- **AC1:** **Given** a report whose `output.xml` exists, **when** `GET /reports/{id}/export?format=junit` is called,
  **then** the response is `application/xml` with `Content-Disposition: attachment; filename="report_<id>_xunit.xml"`.
  The body is RF's xUnit output: a `<testsuite>` root with `tests`/`failures`/`skipped` counts that match the report.
- **AC2 (fixed argv):** the conversion runs
  `[sys.executable, "-m", "robot.rebot", "--output", "NONE", "--log", "NONE", "--report", "NONE", "--nostatusrc", "--xunit", <tmp>/xunit.xml, <output.xml>]`
  as a list (never a shell string) in a `TemporaryDirectory`, with a 120 s timeout. No request value other than
  the report id reaches the argv, and the paths come from the DB.
- **AC3 (seam unchanged):** `build_robot_argv` still never emits `--xunit`, and `validate_advanced_args(["--xunit", "x"])` /
  `["-x", "x"]` are still rejected (regression-pinned).
- **AC4 (errors):** a missing report returns 404, and a missing `output.xml` on disk (e.g. retention) returns 404
  "output.xml not found". A non-zero rebot exit or a timeout returns 422 with the first 500 chars of rebot's stderr.
  An unknown `format` still returns 422.
- **AC5 (auth):** same as the existing CSV/JSON export (`get_current_user`).
- **AC6 (UI):** an "Export JUnit" button next to "Export CSV"/"Export JSON" in `ReportDetailView.vue` and
  `RunDetailPanel.vue` downloads `report_<id>_xunit.xml`. A 422 shows a toast with the server detail.

### Files to touch

- `backend/src/reports/service.py`: `render_xunit(output_xml_path: str) -> bytes`
- `backend/src/reports/router.py`: `format: Literal["csv", "json", "junit"]` with a junit branch in `export_report_results`
- `frontend/src/api/reports.api.ts`: widen the `format` union to `'csv' | 'json' | 'junit'`
- `frontend/src/views/ReportDetailView.vue`, `frontend/src/components/execution/RunDetailPanel.vue`: button and filename `.xml`
- `frontend/src/i18n/locales/{en,de,fr,es}.ts`: `reportDetail.exportJunit`, `reportDetail.exportJunitFailed`
- `frontend/src/docs/content/{en,de,fr,es}.ts`: one sentence in the reports section (JUnit for CI dashboards)

### Test plan

- **pytest** extend `backend/tests/reports/test_export.py`: build a small `output.xml` with RF itself
  (`robot --output … --log NONE --report NONE` on a 1-pass/1-fail suite in `tmp_path`), then check that junit gives XML
  with `failures="1"`, the filename header, 404 for a file missing on disk, and 422 for a corrupt `output.xml`.
  Patch `subprocess.run` for the timeout case. Extend `tests/execution/test_resolver_advanced.py` with `--xunit`/`-x` still rejected.
- **vitest** extend `frontend/src/tests/components/ReportExport.spec.ts`: the JUnit button calls `exportReportResults(id, 'junit')` and downloads `…_xunit.xml`.
- **e2e** extend `e2e/tests/report-export-delete.spec.ts`: upload the fixture report, click "Export JUnit", and assert that
  `page.waitForEvent('download')` gives a filename ending in `_xunit.xml` whose content contains `<testsuite`.

---

## Story V15.2: `%{ENV}` definition check in the Flow Editor

**As a** test author, **I want** the Flow Editor to tell me which `%{NAME}` references my repo's environment does
not define, **so that** I notice a missing `BASE_URL` before a run fails with "Environment variable not found".

**Evidence:** FE-ENV AC1–AC4 **already shipped** (commit `1df81f3`): `utils/robotEnvVars.ts`
(`extractEnvVarRefs`/`collectEnvVarRefs`), the `envRefs` node data (`flowConverter.ts:610`), the `%{}` badge
(`KeywordNode.vue:139-145`), the "Environment variables used" chips (`FlowEditor.vue:412-424, 2367-2382`) and
`e2e/tests/flow-editor-env-vars.spec.ts`. The one missing part is comparing those references against the
environment that 0.14 now injects (`environments/service.py::resolve_env_vars`). This story adds only that delta.

**Which environment:** the Flow Editor uses the same resolution as the keyword palette,
`explorer.store.resolveEnvironmentId(repoId)` (the repo's `environment_id`, else the default env). The run dialog
can pick a different env. That is why the UI names the env it checked against.

### Acceptance criteria

- **AC1 (classify, pure):** `classifyEnvRefs(refs, definedKeys: Set<string> | null)` in `utils/robotEnvVars.ts` returns
  one of three states per ref: `defined` (the key exists in the env), `default` (not defined, with an inline `=default`)
  or `missing` (not defined, no default). `definedKeys === null` (no env resolvable) returns `unknown` for all. Keys are compared case-sensitively.
- **AC2 (panel):** **Given** the repo's env defines `BASE_URL`, **when** the active test uses `%{BASE_URL}`,
  `%{TIMEOUT=10}` and `%{API_TOKEN}`, **then** the "Environment variables used" chips show `BASE_URL` as defined,
  `TIMEOUT` as neutral with "not in <env>, inline default used", and `API_TOKEN` as a warning chip (`--color-accent`)
  with the tooltip "Not defined in environment <env>. The run fails unless the server's own environment provides it."
  The wording is soft on purpose, because the subprocess runner also inherits the server's `os.environ`.
- **AC3 (node badge):** the `%{}` badge of a step with at least one `missing` ref gets the warning style, and its tooltip marks those names.
- **AC4 (no false alarms):** with no resolvable env, or when `GET /environments/{id}/variables` fails, no warning
  is shown and the display is exactly today's. Secret variables count as defined, and their values are never shown.
- **AC5 (no form mutation):** env keys reach `KeywordNode` through `provide/inject`, not through `props.form` or node data, so the
  deep form watcher does not fire and there is no selection reset. Round-trip is unchanged.
- **AC6 (freshness):** keys are fetched once per env via `environments.store.fetchVariables(envId)` (already cached per env id),
  and fetched again when the repo/env changes.

### Files to touch

- `frontend/src/utils/robotEnvVars.ts`: `classifyEnvRefs`
- `frontend/src/stores/explorer.store.ts`: export `resolveEnvironmentId` from the store return
- `frontend/src/components/editor/FlowEditor.vue`: resolve the env, load keys, `provide('envVarKeys', …)`, and chip states and tooltips
- `frontend/src/components/editor/flow/KeywordNode.vue`: `inject('envVarKeys')` and badge warning class
- `frontend/src/i18n/locales/{en,de,fr,es}.ts`: `flowEditor.envVarDefined`, `envVarDefaultUsed`, `envVarMissing`, `envVarCheckedAgainst`
- `frontend/src/docs/content/{en,de,fr,es}.ts`: one sentence in the `env-variables` section

### Test plan

- **vitest** extend `frontend/src/tests/components/FlowEditorEnvVars.spec.ts`: a `classifyEnvRefs` matrix (defined, default,
  missing, null keys → unknown, case sensitivity). A new `KeywordNodeEnvBadge.spec.ts`: an injected key set without the name gives the warning class, and no injection gives today's badge.
- **e2e** extend `e2e/tests/flow-editor-env-vars.spec.ts`: create an env with `BASE_URL` via API, create the repo with that
  `environment_id`, and seed 2 test cases using `%{BASE_URL}` and `%{MISSING_VAR}`. Assert that the `BASE_URL` chip is not a warning and the
  `MISSING_VAR` chip is. The existing `%{HOME=/tmp}` assertion stays green.

---

## Story V15.3: Inert run options: wire up `max_retries`, retire `parallel`

**As a** team lead, **I want** a run to retry itself when it fails, and I want the run options RoboScope ignores to disappear,
**so that** flaky nightly runs recover without anyone clicking, and nobody trusts a knob that does nothing.

**Evidence (verified):** the UI does **not** expose either field. There is no Vue reference, only the TS types
(`types/api.types.ts:32-33`, `domain.types.ts:112-114`). The API accepts both (`execution/schemas.py:25-26`), stores them
(`service.py:35-36`) and never reads them (`tasks.py` does not, and neither does `resolver.py`). The only other
`max_retries` in the code are the unrelated git/webhook retry loops. A third inert knob came up in the same pass:
the `max_parallel_runs` setting (`settings/service.py:14`, shown in `SettingsView.vue:34`). The task executor is fixed at
`max_workers=1` (`task_executor.py:32`).

**Recommendation:** wire up `max_retries`, which is small because `service.retry_run` already exists and copies the right fields.
Retire `parallel` (pabot is out of scope) and hide `max_parallel_runs`. Keep both DB columns, so no migration is needed.

### Acceptance criteria

- **AC1 (auto-retry):** **Given** a run with `max_retries = 2` that ends `FAILED` or `TIMEOUT`, **when** `execute_test_run`
  finishes (after the report is parsed, so each attempt keeps its own report), **then** a new run is created via
  `retry_run(session, run, run.triggered_by)` with `retry_count = run.retry_count + 1`. `schedule_id` is copied,
  so the schedule's no-overlap guard sees it. The new run is committed and then dispatched. The chain stops at `retry_count == max_retries`.
- **AC2 (no retry):** `PASSED`, `CANCELLED` and `ERROR` never auto-retry. `ERROR` covers setup failures such as a missing env,
  where a retry cannot help.
- **AC3 (API validation):** `RunCreate.parallel = True` returns 422 "parallel execution is not supported". The field stays
  accepted as `false` for API compatibility, and the response still carries it.
- **AC4 (advanced-config guardrail):** `max_retries > 0` together with a non-empty `advanced_config` returns 422 at create.
  `retry_run` does not copy `advanced_config`, and copying it would be an ungated writer. The trip-wire test stays green.
- **AC5 (UI):** the run dialog in `ExecutionView.vue` gets a "Retries on failure" select (0–3; the schema allows ≤5). It is disabled
  with a hint when advanced options are set. The run list/detail shows "Attempt n of m" when `max_retries > 0` or `retry_count > 0`.
- **AC6 (settings honesty):** `max_parallel_runs` is no longer seeded or shown in Settings. An existing row is harmless,
  but the Settings view must not render it.
- **AC7 (docs):** the in-app execution docs describe automatic retries (whole-run re-execution, not rerun-failed) in EN/DE/FR/ES.

### Files to touch

- `backend/src/execution/schemas.py`: `model_validator` on `RunCreate` (AC3, AC4)
- `backend/src/execution/tasks.py`: `_maybe_auto_retry(session, run)` after `parse_report` in the success path
- `backend/src/execution/service.py`: none, unless `retry_run` gains a `schedule_id` carry-over (set it on the new run in the task instead)
- `backend/src/settings/service.py`: drop the `max_parallel_runs` seed entry
- `frontend/src/views/ExecutionView.vue`: retries select, `max_retries` in the run payload, attempt label
- `frontend/src/components/execution/RunDetailPanel.vue`: attempt label
- `frontend/src/views/SettingsView.vue`: drop the `max_parallel_runs` mapping and skip the key
- `frontend/src/types/api.types.ts`: drop `parallel` from the create payload type
- `frontend/src/i18n/locales/{en,de,fr,es}.ts`: `execution.runDialog.retries`, `retriesHint`, `retriesDisabledAdvanced`, `execution.attemptOf`
- `frontend/src/docs/content/{en,de,fr,es}.ts`: retries paragraph

### Test plan

- **pytest** new `backend/tests/execution/test_auto_retry.py`: patch the runner result and `dispatch_task`. FAILED plus
  max_retries=1 creates exactly one run with retry_count=1 and the same schedule_id, then dispatches. At retry_count==max_retries
  no run is created. PASSED, CANCELLED and ERROR create none. The API returns 422 for `parallel: true` and for `max_retries` with `advanced_config`.
  Update `tests/settings/test_service.py` for the removed seed. `test_schedule_trigger_gate_tripwire.py` is unchanged and green.
- **vitest** `frontend/src/tests/components/RunRetries.spec.ts`: the select value reaches the `createRun` payload, it is disabled with advanced
  options, and the attempt label renders.
- **e2e** extend `e2e/tests/execution-run.spec.ts` (same repo/env setup): start a run of an always-failing test with
  retries = 1 from the dialog, then assert that a second run with "Attempt 2 of 2" appears and no third one.

---

## Story V15.4 (decision, gated on feedback): Saved run templates

**Status:** gated. **Do not implement** until the question below has an answer. No story file.

**Why gated:** since 0.14, a schedule stores target, branch, environment, runner and tags, can be paused
(`is_active=false`) and has **Run now** (`POST /schedules/{id}/run`). A paused schedule is therefore already a saved
run configuration with a launch button. A dedicated `RunTemplate` model would duplicate it, unless users need
something a schedule cannot hold.

### Question to validate with users (after 0.14 has been in use for about 2–4 weeks)

> "To save a run configuration and start it again later, does a **paused schedule plus Run now** cover your need?
> If not, what is missing: (a) run variables or advanced args/modifiers, (b) starting it from the Explorer/editor
> instead of the Schedules tab, (c) per-user or private templates, (d) something else?"

Channel: a GitHub discussion plus direct asks to 3 or more active teams. Decision rule: if most answers are "covered" or (b),
take design 1. If (a) is frequent, take design 2.

### Minimal design 1: "covered" (about 0.5 day)

- The run dialog gets **"Save as paused schedule"**, which creates a schedule with `is_active=false`, a placeholder cron and a name.
- The Schedules tab gets a "Paused" filter. Run now already exists. No new model, no migration.

### Design 2: templates must carry variables or advanced config (M, not minimal)

- A `RunTemplate` holds the `RunCreate` fields including `variables`/`advanced_config`. **Launching must call
  `gate_advanced_execution` with the launching user** (CLAUDE.md: any writer of `advanced_config` outside `start_run`
  is a code-exec bypass). The same rule would apply if `Schedule.advanced_config` were ever activated.
  Scheduled or unattended launches of such templates stay impossible, because there is no user context for the gate.

---

## Story V15.5: Custom Dockerfile and your own container image

Maintainer request: for the Docker runner, users must be able to (a) edit the generated Dockerfile, (b) import their own
Dockerfile, and (c) run an existing image instead of a RoboScope-built one. Story file:
`_bmad-output/implementation-artifacts/v15-5-custom-dockerfile-and-image.md`.

### Design (minimal)

- Two columns on `environments`: `dockerfile_override TEXT NULL`, `docker_image_custom BOOLEAN NOT NULL DEFAULT false`
  (lightweight migrations + Alembic revision `a9d4c7e2b1f0`).
- (a)+(b) are one mechanism: `PUT /environments/{id}/dockerfile {content}`; null/empty resets. Import is client-side
  (`file.text()` into the editor), saved only on Save. `GET /dockerfile` returns the override when set; a build uses it and
  then does not need packages.
- (c) `PATCH {docker_image, docker_image_custom: true}`. A custom image is never stale; building a RoboScope image again switches
  back to managed.
- Both are gated by `require_package_op("docker_build")` (a Dockerfile's `RUN` steps execute on the host at build time).

### Acceptance criteria

See the story file (AC1–AC8). Contract for custom images: the runner executes `python -m robot --outputdir /output … <target>`
with working dir `/workspace` (repo, read-only); the image must provide `python` with `robotframework` plus the test libraries,
and no `ENTRYPOINT` that swallows the command.

### Test plan

Backend pytest (`tests/environments/test_custom_docker.py`), vitest (`EnvironmentDocker.spec.ts`), e2e
(`environments-custom-docker.spec.ts`, no real Docker build).

---

## Hardening backlog (open items from the 0.12.1 review, re-checked against the code 2026-09-25)

| # | Item | State | Evidence | Suggested fix |
|---|---|---|---|---|
| H-1 | `change_password` to the seed password clears the rotation flag | **Open (mitigated)** | `auth/service.py:141-148` checks only `wrong_current`/`too_short`/`same_as_current`, then sets `password_change_required = False`. A user who already rotated can change back to `admin123`. `authenticate_user` (`:108`) flags it again at the next login, so the gap lasts until then. | Reject `new_password == DEFAULT_ADMIN_PASSWORD` with 422 `default_password`. |
| H-2 | `cancel-all` role floor | **Floor fixed; 500 edge open** | `execution/router.py:773-822` now filters runs by effective role ≥ RUNNER per repo. `Role(current_user.role)` at `:802` still raises `ValueError` (500) for a role string outside the enum. The same pattern is in `auth/dependencies.py:127,180`, so it is systemic and only reachable with a non-enum role row. | Map an unknown role to -1 instead of a 500 (one helper in `auth/constants.py`). |
| H-3 | `ensure_admin_exists` fresh-DB branch skips the sweep marker | **Open (low)** | `auth/service.py:196-206` creates the admin and `return`s before `SWEEP_MARKER_KEY` is stamped, so the second boot runs the one-time bcrypt sweep over every unflagged user. | Stamp the marker in the fresh-DB branch too. |
| H-4 | Postgres in-flight-guard tz | **Open (Postgres only)** | `repos/router.py:249`, `environments/router.py:320` and `:554` compute `now(UTC) - updated_at.replace(tzinfo=UTC)`. `TimestampMixin` (`database.py:68-71`) writes `func.now()` into naive `DateTime` columns, which Postgres fills with **session-local** time. On a non-UTC server, the 120 s / 600 s guards are shifted by the UTC offset: east of UTC they block re-sync/rebuild for hours, west of UTC they never block. SQLite (`CURRENT_TIMESTAMP` = UTC) is unaffected. | Pin the Postgres session to UTC in `database.py` (`connect_args={"options": "-c timezone=utc"}`), plus a test. |
| H-5 | WS 4401 reconnect storm | **Open** | `frontend/src/composables/useWebSocket.ts:44-47`: `onclose` reconnects every 3 s whatever the close code. The backend closes with 4401 on a bad or expired token (`main.py:593, 626`), so a stale token loops forever: one handshake per tab every 3 s, each an auth attempt. | On `event.code === 4401`, stop reconnecting and do not connect without `access_token` (the same guard as the singleton composables). Reconnect after a token refresh. |
| — | Repo delete orphans runs/recordings (G-26) | **Fixed in 0.14.0** | commit `e29a108`, CHANGELOG 0.14.0 "Deleting a repository left orphaned data behind". | — |

Each open item is well under a day. They could form a V15.5 "hardening sweep" story, or ship as separate fix PRs.
