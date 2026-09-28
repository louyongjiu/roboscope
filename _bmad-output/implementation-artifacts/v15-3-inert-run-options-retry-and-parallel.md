# Story V15.3: Inert run options: wire up `max_retries`, retire `parallel`

Status: review

Epic: V15 — Follow-through on 0.14 (`_bmad-output/planning-artifacts/v015-epics.md`)
Story Key: `v15-3-inert-run-options-retry-and-parallel`
Size: S–M (about three quarters of a day)
Depends on: none (touches `execution/tasks.py`, so land it separately from any other change to that file)

## Story

As a team lead,
I want a failed run to retry itself a configurable number of times, and I want run options RoboScope ignores to disappear,
so that flaky nightly runs recover without a click and nobody trusts a knob that does nothing.

## Findings (verified 2026-09-25)

- **The UI does not expose either field.** There is no `.vue` reference, only TS types (`types/api.types.ts:32-33`, `types/domain.types.ts:112-114`).
- The API accepts them (`execution/schemas.py:25-26`, `max_retries` 0–5), stores them (`execution/service.py:35-36`), and `retry_run` copies
  them (`service.py:124-146`). **Nothing reads them**: not `tasks.py`, not `resolver.py`. The other `max_retries` in the code are the
  unrelated git clone/sync (`repos/tasks.py`) and webhook delivery loops.
- A third inert knob: the `max_parallel_runs` setting (`settings/service.py:14`, displayed via `SettingsView.vue:34`), while the task
  executor is hard-wired to `max_workers=1` (`task_executor.py:32`).

**Decision:** wire up `max_retries`, because `retry_run` already does the copy and the hook is only a few lines. Retire `parallel`, because pabot is out of scope.
Hide `max_parallel_runs`. The DB columns stay, so no migration is needed.

## Acceptance Criteria

1. **AC1 (auto-retry):** a run with `max_retries = N > 0` ending `FAILED` or `TIMEOUT` and `retry_count < max_retries` creates
   `retry_run(session, run, run.triggered_by)` **after** `parse_report` (each attempt keeps its own report) and sets
   `new_run.schedule_id = run.schedule_id`. It then `session.commit()`s and `dispatch_task(execute_test_run, new_run.id)`s. The chain ends at `retry_count == max_retries`.
2. **AC2:** `PASSED`, `CANCELLED` (both cancel paths, `tasks.py:479-487`) and `ERROR` (setup failures and the exception path `tasks.py:538-548`) never auto-retry.
3. **AC3:** `RunCreate` with `parallel: true` returns 422 "Parallel execution is not supported". `false` is still accepted, and `RunResponse.parallel` is unchanged.
4. **AC4 (guardrail):** `RunCreate` with `max_retries > 0` and a non-empty `advanced_config` returns 422. Auto-retry never reads or copies `advanced_config`.
5. **AC5 (UI):** the run dialog (`ExecutionView.vue`) has a "Retries on failure" select 0–3, sent as `max_retries`. It is disabled with a hint
   when advanced options are set. The runs table and `RunDetailPanel.vue` show "Attempt {n} of {m}" (`n = retry_count + 1`, `m = max_retries + 1`)
   when `max_retries > 0 || retry_count > 0`.
6. **AC6:** `max_parallel_runs` is not seeded and not rendered in Settings (an existing DB row is ignored by the view).
7. **AC7:** the in-app execution docs (EN/DE/FR/ES) explain retries: the whole run is re-executed (not rerun-failed), only on failed or timed-out runs,
   each attempt appears as its own run and report, and retries are not available with advanced options.

## Tasks / Subtasks

- [x] `execution/schemas.py`: `@model_validator(mode="after")` on `RunCreate` for AC3 and AC4
- [x] `execution/tasks.py`: `_maybe_auto_retry(session, run) -> None`, called after the `parse_report` block and before `return` in the
      success path. Wrap it in try/except plus `logger.exception`: a retry failure must never flip the finished run's status. (AC1, AC2)
- [x] `settings/service.py`: remove the `max_parallel_runs` seed entry. `SettingsView.vue`: remove the mapping and filter out the key (AC6)
- [x] `ExecutionView.vue`: retries select, payload, attempt label. `RunDetailPanel.vue`: attempt label (AC5)
- [x] `types/api.types.ts`: remove `parallel` from the create payload type
- [x] i18n `execution.runDialog.retries`, `retriesHint`, `retriesDisabledAdvanced`, `execution.attemptOf` (`{n}`/`{m}` params) in EN/DE/FR/ES
- [x] Docs paragraph in the execution section of all 4 doc locales (AC7)

## Dev Notes

- **Why no retry on ERROR:** `ERROR` is set for a missing environment, venv or Docker problems and unexpected exceptions (`tasks.py:294-366`,
  `:545`). A retry repeats the same failure and doubles the noise. FAILED/TIMEOUT are the flaky-test cases.
- **Why 422 instead of copying `advanced_config`:** CLAUDE.md says any writer of `ExecutionRun.advanced_config` that bypasses
  `gate_advanced_execution` is a code-exec bypass, and `tasks.py` re-validates freeform args but **not** `prerun_modifiers`. An auto-retry
  runs in the background thread without a request or user context for the gate. Retrying *without* the config would silently run a different test,
  so the combination is refused up front. `test_schedule_trigger_gate_tripwire.py` must stay green.
- **Why copy `schedule_id`:** the 0.14 schedule trigger skips a due schedule while its previous run is pending or running (V14.1 AC3). A retry
  that is not linked to the schedule would let the next scheduled run overlap it. The manual `POST /runs/{id}/retry` keeps its current behaviour.
- The executor is single-worker. Calling `dispatch_task` from inside the running task only queues the retry behind it, so it cannot deadlock.
- Commit before dispatch (CLAUDE.md): the background session must see the new row. Broadcast the new run's pending status the same way
  `start_run` does if the runs list relies on it. Check `_broadcast_run_status` usage in `router.py::start_run`.
- Each retry fires its own `run.*` webhooks. That is expected, and no dedup is planned.
- `ponytail:` no backoff between attempts. The retry queues immediately behind the failed run. Add a delay when users report
  flaky-infra retries that fail too quickly.
- Out of scope: `max_retries` on schedules (the `Schedule` model has no column, and scheduled runs keep 0), pabot, and rerun-failed (G-7).

### Testing

- New `backend/tests/execution/test_auto_retry.py`: patch the runner to return `success=False` (and `timed_out=True` for TIMEOUT), and patch `dispatch_task`.
  Then check: one retry with `retry_count=1`, the same `schedule_id`/target/env, dispatched once; `retry_count == max_retries` creates none;
  PASSED/CANCELLED/ERROR create none; an exception inside `_maybe_auto_retry` leaves the original status intact. For the API,
  `parallel: true` returns 422, and `max_retries: 1` plus `advanced_config` returns 422 (it never reaches the gate audit).
- `backend/tests/settings/test_service.py`: update the seed expectations.
- New `frontend/src/tests/components/RunRetries.spec.ts`: the select reaches the `createRun` payload, it is disabled when advanced args are set, and the attempt label shows "Attempt 2 of 3".
- **e2e** `e2e/tests/execution-run.spec.ts` (extend, reusing its repo/env helpers): seed an always-failing test (`Fail    boom`) and start it
  from the dialog with retries = 1. Poll the runs list until two runs exist for the target. Assert that the newer one shows "Attempt 2 of 2" and that no
  third run appears within a short grace period.

### References

- [Source: backend/src/execution/service.py#retry_run]
- [Source: backend/src/execution/tasks.py#execute_test_run]
- [Source: CLAUDE.md#EXEC feature flags are the explicit default-OFF exception]
- [Source: _bmad-output/planning-artifacts/research/v0.14-functional-gap-brainstorm-2026-09-24.md#G-5, G-6, G-8]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Backend: `SECRET_KEY=test .venv/bin/pytest -q -n auto` (2484 passed incl. 11 new; tripwire green).
- Frontend: `vue-tsc --noEmit` clean, `vitest run` 926 passed (3 new), `vite build` OK. E2E written, not run (per instructions).

### Completion Notes List

- AC1/AC2: `tasks.py::_maybe_auto_retry` runs after `parse_report` in the success path only (cancel and exception paths return
  earlier, so CANCELLED/ERROR never reach it); guarded by try/except + `logger.exception` + `session.rollback()`. Reuses
  `service.retry_run`, copies `schedule_id`, commits before `dispatch_task`. A `TaskDispatchError` marks the retry ERROR
  (mirrors `start_run` H3) instead of stranding it in PENDING. No pending broadcast: `start_run` doesn't broadcast either;
  the retry's RUNNING broadcast refreshes the list.
- AC3/AC4: `RunCreate` model validator; the 422 fires during body validation, before `gate_advanced_execution` (pinned).
- AC5: the run dialog derives `advancedConfig` as a computed (the former inline builder, unchanged behaviour) so the retries
  select can disable itself; the payload forces `max_retries: 0` when advanced config is sent.
  **Deviation:** the attempt label uses `m = max(max_retries, retry_count) + 1` so a manual retry past the budget never reads
  "Attempt 2 of 1".
- AC6: seed entry + Settings mapping removed, legacy row filtered in `SettingsView.vue`; `maxParallelRuns` i18n description
  removed from all 5 locales. `e2e/tests/settings-unsaved-changes.spec.ts` used `max_parallel_runs` as its int fixture row;
  switched to `default_timeout`.
- `test_service.py::test_create_run_with_all_fields` used `parallel=True`; now asserts the default `False`.
- AC7: "Automatic retries" paragraph added under the existing Retry text in the execution docs (EN/DE/FR/ES), no new ids.

### File List

- backend/src/execution/schemas.py
- backend/src/execution/tasks.py
- backend/src/settings/service.py
- backend/tests/execution/test_auto_retry.py (new)
- backend/tests/execution/test_service.py
- backend/tests/settings/test_service.py
- frontend/src/views/ExecutionView.vue
- frontend/src/views/SettingsView.vue
- frontend/src/components/execution/RunDetailPanel.vue
- frontend/src/types/api.types.ts
- frontend/src/i18n/locales/{en,de,fr,es,zh}.ts
- frontend/src/docs/content/{en,de,fr,es}.ts
- frontend/src/tests/components/RunRetries.spec.ts (new)
- e2e/tests/execution-run.spec.ts
- e2e/tests/settings-unsaved-changes.spec.ts
- CHANGELOG.md
