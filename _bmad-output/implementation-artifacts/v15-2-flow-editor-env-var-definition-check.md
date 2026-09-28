# Story V15.2: `%{ENV}` definition check in the Flow Editor

Status: review

Epic: V15 — Follow-through on 0.14 (`_bmad-output/planning-artifacts/v015-epics.md`)
Story Key: `v15-2-flow-editor-env-var-definition-check`
Size: S (about half a day, frontend only)
Depends on: FE-ENV (shipped, commit `1df81f3`), V14.2 env-var injection (shipped in 0.14.0)

## Story

As a test author,
I want the Flow Editor to flag `%{NAME}` references my repo's environment does not define,
so that I catch a missing `BASE_URL` before a run fails with "Environment variable not found".

## Scope note: most of FE-ENV already exists

`flow-editor-followups/FE-ENV-environment-variables.md` AC1–AC4 are implemented, so **do not rebuild them**:
- `frontend/src/utils/robotEnvVars.ts`: `extractEnvVarRefs`, `collectEnvVarRefs` (tests: `FlowEditorEnvVars.spec.ts`)
- `flowConverter.ts:610`: `envRefs` on node data
- `KeywordNode.vue:139-145`: `%{}` badge with a tooltip
- `FlowEditor.vue:412-424` (`activeEnvVarRefs`) and `:2367-2382`: the "Environment variables used" chips
- `e2e/tests/flow-editor-env-vars.spec.ts`

This story only adds the comparison against the environment's defined variable **keys**.

## Acceptance Criteria

1. **AC1 (pure helper):** `classifyEnvRefs(refs: EnvVarRef[], definedKeys: Set<string> | null)` returns
   `{ ref, state }[]` where `state` is `defined` | `default` | `missing` | `unknown`. `null` keys give `unknown` for all, and names are compared case-sensitively.
2. **AC2 (panel chips):** a `defined` chip gets the tooltip "Defined in <env>". A `default` chip is neutral with "Not in <env>. Inline default used".
   A `missing` chip gets a warning style (`--color-accent`, plus `data-state="missing"`) and the tooltip "Not defined in environment <env>. The run fails
   unless the server's own environment provides it." `unknown` renders exactly as today.
3. **AC3 (node badge):** the `%{}` badge gets the warning class when any of the node's `envRefs` is `missing`. The tooltip suffixes those names with "(not defined)".
4. **AC4 (no false alarms):** if no env is resolvable, or the variables fetch fails, nothing changes visually. Secret variables count as defined.
   Only keys are used, and values are never read or rendered.
5. **AC5 (no form mutation):** keys flow `FlowEditor` → `provide('envVarKeys', computed<Set<string> | null>)` → `KeywordNode` `inject`.
   Nothing is written to `props.form` or node data, and the selection/active item survives the keys loading.
6. **AC6 (fetch):** env id = `explorer.store.resolveEnvironmentId(repoId)`. Keys come from `environments.store.fetchVariables(envId)`
   (a per-env cache in `variables[envId]`), fetched once per (repoId, envId) and again when `repoId` changes.

## Tasks / Subtasks

- [x] `utils/robotEnvVars.ts`: `classifyEnvRefs` (AC1)
- [x] `stores/explorer.store.ts`: add `resolveEnvironmentId` to the returned object (AC6)
- [x] `FlowEditor.vue` (AC2, AC4, AC5, AC6)
  - [x] `envVarKeys` computed from `envStore.variables[envId]` → `new Set(vars.map(v => v.key))`, with `null` when there is no env or on error
  - [x] `watch(() => props.repoId, …, { immediate: true })` → `fetchVariables(envId).catch(() => {})`
  - [x] `provide('envVarKeys', envVarKeys)`; chips iterate `classifyEnvRefs(activeEnvVarRefs, envVarKeys)` with state class + tooltip
  - [x] `envName` for the tooltip from `envStore.environments`
- [x] `KeywordNode.vue`: `inject('envVarKeys', null)`, a computed `hasMissing`, and a `flow-node-env-badge--missing` class (AC3)
- [x] i18n `flowEditor.envVarDefined`, `envVarDefaultUsed`, `envVarMissing`, `envVarCheckedAgainst` in EN/DE/FR/ES with `{env}` / `{name}` params.
      Any literal `%{…}` in strings must escape braces (`%{'{'}NAME{'}'}`). Prod build check.
- [x] Docs: one sentence in the `env-variables` section in all 4 doc locales.

## Dev Notes

- **Which environment:** the Flow Editor has no run context. It uses the same resolution as the keyword palette
  (`explorer.store.ts:130-142`: the repo's `environment_id`, else `is_default`). The run dialog may pick another env, so
  the tooltip always names the env that was checked (`envVarCheckedAgainst`).
- **Why the wording is soft:** `subprocess_runner` starts from `os.environ.copy()` and adds env vars on top (V14.2), so `%{HOME}`
  and other server variables resolve even when the RoboScope env doesn't define them. `missing` is a warning, never an error, and never blocks saving.
- `GET /environments/{id}/variables` needs only authentication (`environments/router.py:798-806`) and masks secret values, so
  VIEWERs can see the check too. Only `.key` is used.
- **FlowEditor traps (CLAUDE.md):** the deep `props.form` watcher resets `activeItemIndex`/`selectedNode` on any form mutation.
  This story is display-only, so provide/inject keeps it off that path. Don't add the state to `flowConverter` node data. That
  would force a rebuild when the keys arrive.
- Case sensitivity: on Windows servers RF's `%{}` lookup is case-insensitive, but the check compares exactly.
  `// ponytail: exact-case compare; relax if Windows-hosted teams report false warnings`.
- Out of scope: warnings in the run dialog, and `%{}` inside `*** Variables ***` values (FE-ENV AC3 covers only the active item's steps).

### Testing

- `frontend/src/tests/components/FlowEditorEnvVars.spec.ts` (extend): the `classifyEnvRefs` matrix covers defined, default, missing, `null` → unknown,
  a `Base_Url` vs `BASE_URL` mismatch giving missing, and an empty ref list.
- New `frontend/src/tests/components/KeywordNodeEnvBadge.spec.ts`: mount `KeywordNode` with `global.provide.envVarKeys` set to a Set without the
  name, which gives the `--missing` class. Without the provide it renders the plain badge.
- **e2e** `e2e/tests/flow-editor-env-vars.spec.ts` (extend): create an env via API with variable `BASE_URL`, create the repo with that
  `environment_id` (`RepoCreate.environment_id`), and seed **2 test cases** (the first uses `%{BASE_URL}` and `%{MISSING_VAR}`). Open the flow and assert
  that the `MISSING_VAR` chip has `data-state="missing"` and `BASE_URL` does not. The existing `%{HOME=/tmp}` test stays green.

### References

- [Source: _bmad-output/planning-artifacts/flow-editor-followups/FE-ENV-environment-variables.md]
- [Source: frontend/src/utils/robotEnvVars.ts]
- [Source: frontend/src/stores/explorer.store.ts#resolveEnvironmentId]
- [Source: CLAUDE.md#FlowEditor deep form-watcher RESETS the active item]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

- `vue-tsc --noEmit` clean; `vitest run` 82 files / 930 tests passed; `vite build` OK (prod i18n parse).
- e2e spec written, not run (per instructions).

### Completion Notes List

- `classifyEnvRefs` added next to the FE-ENV helpers; exact-case compare marked with a `ponytail:` comment.
- FlowEditor watches `[repoId, resolvedEnvId]` (not only `repoId`), so the fetch also fires when the repos/envs
  stores finish loading after the editor mounts. Fetch errors are swallowed → keys stay `null` → `unknown` (AC4).
- Keys reach `KeywordNode` only through `provide('envVarKeys')`; `props.form` and node data are untouched (AC5).
- The unknown state keeps the old look; chips carry `data-state` for all states (incl. `unknown`).
- Deviation: one extra i18n key `flowEditor.envVarNotDefined` for the node-badge "(not defined)" suffix (AC3).
  ZH falls back to EN (no hand entry). No literal `%{…}` in the new strings, so no brace escaping needed.
- `envVarCheckedAgainst` is the tooltip of the chips' title label (only when keys are loaded).
- e2e: new describe in `flow-editor-env-vars.spec.ts` creates an env with `BASE_URL`, a repo bound to it, and a
  2-test-case suite; asserts `MISSING_VAR` chip `data-state="missing"`, `BASE_URL` `defined`, one warning badge.

### File List

- frontend/src/utils/robotEnvVars.ts
- frontend/src/stores/explorer.store.ts
- frontend/src/components/editor/FlowEditor.vue
- frontend/src/components/editor/flow/KeywordNode.vue
- frontend/src/i18n/locales/{en,de,fr,es}.ts
- frontend/src/docs/content/{en,de,fr,es}.ts
- frontend/src/tests/components/FlowEditorEnvVars.spec.ts
- frontend/src/tests/components/KeywordNodeEnvBadge.spec.ts (new)
- e2e/tests/flow-editor-env-vars.spec.ts
- CHANGELOG.md
