# Story V15.5: Custom Dockerfile and your own container image

Status: review

Epic: V15 — Follow-through on 0.14 (`_bmad-output/planning-artifacts/v015-epics.md`)
Story Key: `v15-5-custom-dockerfile-and-image`
Size: S (about a day)
Depends on: none (builds on the Docker build of Story 2.3 and the GOV `docker_build` op)

## Story

As a test engineer running tests with the Docker runner,
I want to edit the generated Dockerfile, import my own Dockerfile, or point the environment at an image I already have,
so that system packages, private base images or company-approved images work without leaving RoboScope.

## Acceptance Criteria

1. **AC1 (schema):** `environments` gains `dockerfile_override TEXT NULL` and `docker_image_custom BOOLEAN NOT NULL DEFAULT false`.
   Existing databases get them through the lightweight idempotent migrations in `database.py` (`_migrate_sqlite` and
   `_migrate_postgres`); Alembic revision `a9d4c7e2b1f0` (after `e7c1a2b3d4f5`) keeps parity.
2. **AC2 (edit + import = one mechanism):** `PUT /environments/{id}/dockerfile` with `{content: str | null}` stores the override;
   null or whitespace-only content clears it. Validation (422): at most 100 KB, no NUL byte, and the first instruction
   (skipping blank lines, comments and leading `ARG`s) is `FROM`, case-insensitive. Returns the `EnvResponse`.
3. **AC3 (read):** `GET /environments/{id}/dockerfile` returns the override when set, otherwise the generated file
   (still 400 without packages). `EnvResponse.dockerfile_customized: bool` (model property) flags an override; the text
   itself is never part of list/detail responses.
4. **AC4 (build):** `POST /{id}/docker-build` no longer requires packages when an override exists. `tasks.py::build_docker_image`
   sends the override instead of the generated Dockerfile, and on success sets `docker_image_custom = false` (a RoboScope
   build switches back to a managed image).
5. **AC5 (own image):** `EnvUpdate.docker_image_custom`; `PATCH` with `{docker_image, docker_image_custom: true}` marks the image
   user-provided. A custom image is never `docker_image_stale`. `docker_image` is validated loosely (trimmed, one token without
   whitespace, ≤ 500 chars; empty clears). `docker_image_custom: true` without an image is 422.
6. **AC6 (governance):** `PUT /dockerfile` is gated by `require_package_op("docker_build")`. A `PATCH` that *changes*
   `docker_image` or `docker_image_custom` runs the same check inline (flag off: 403 even for ADMIN; below the role floor: 403;
   both audited by the helper). Other PATCH fields are unaffected.
7. **AC7 (UI):** the Docker section of an environment shows "Custom image" / "Customized Dockerfile" badges, a "Use your own image"
   form with a "Back to RoboScope-built image" action, and an editable monospace Dockerfile `<textarea>` with Save,
   "Reset to generated" (only when customized) and "Import file…" (read client-side with `file.text()`, saved only on Save).
   Mutating controls are hidden when `packageManagement` is off or the user is below EDITOR (textarea read-only).
   The section is shown even without packages (so a custom image/Dockerfile can be set up first). i18n EN/DE/FR/ES.
8. **AC8 (contract, documented):** the Docker runner starts the container with `python -m robot --outputdir /output … <target>`
   (`docker_runner._build_robot_command` → `build_robot_argv(spec, python="python", output_dir="/output")`), working dir
   `/workspace` (repo, read-only) and `/output` (read-write). A custom image or Dockerfile must provide `python` on `PATH` with
   `robotframework` importable, plus every library the tests use, and must not set an `ENTRYPOINT` that swallows the command.
   Documented in the in-app docs `docker-build` subsection (DE `environments-docker-build`).

## Tasks / Subtasks

- [x] Model columns + `dockerfile_customized` property; lightweight migrations (SQLite + Postgres); Alembic revision (AC1)
- [x] `DockerfileUpdate` schema + validation; `EnvUpdate.docker_image_custom` + image-ref validator; stale rule (AC2, AC5)
- [x] Router: `PUT /dockerfile`, GET returns override, build without packages, PATCH inline gate + 422 (AC2–AC6)
- [x] Build task uses override and resets `docker_image_custom`; clone copies both fields (AC4)
- [x] Frontend: types, `saveDockerfile` API, Docker section UI, CSS, i18n EN/DE/FR/ES (AC7)
- [x] In-app docs EN/DE/FR/ES, CHANGELOG (AC8)
- [x] Tests (see Testing)

## Dev Notes

- **Trust level:** a Dockerfile's `RUN` steps execute on the Docker host at build time, and the chosen image runs every test, so
  both are gated like a build (`docker_build` op), not just EDITOR.
- **Audit:** successful PUT/PATCH are logged by the audit middleware; blocked attempts are logged by `require_package_op` itself
  (the middleware skips ≥ 400).
- **Why the PATCH path, not a new endpoint for the image:** `docker_image` was already PATCH-able; gating only actual changes keeps the
  existing per-field PATCH calls from the UI working when package management is off.
- `EnvUpdate.docker_image_custom` is `bool = False` with `exclude_unset` semantics — an explicit `null` is rejected by pydantic
  instead of hitting the NOT NULL column.
- Out of scope: build context files (`COPY` of local files — the build uses an in-memory tarball with only the Dockerfile),
  registry credentials for private images (the host's Docker login is used), validating that a custom image contains `robot`.

### Testing

- `backend/tests/environments/test_custom_docker.py`: PUT/GET/reset round-trip and list flag, empty clears, validation (FROM not first,
  comment/ARG only, NUL, >100 KB), lowercase `from`, 403 for viewer/runner, 403 with the flag off, build without packages when
  overridden, build task sends the override (mocked Docker client) and resets the custom flag, generated file without override,
  stale=false for a custom image, PATCH set/clear, bad refs, custom-without-image 422, flag-off 403 for image change only, and the
  lightweight SQLite migration adds the columns to an old table idempotently.
- `frontend/src/tests/components/EnvironmentDocker.spec.ts`: edit + save + badge, reset reloads generated, file import fills editor
  without saving, set custom image + back to managed, read-only below editor.
- `e2e/tests/environments-custom-docker.spec.ts`: edit/save/reload/reset Dockerfile, set custom image and see the badge (no real build).

### References

- [Source: backend/src/environments/router.py#get_dockerfile, put_dockerfile, docker_build, patch_env]
- [Source: backend/src/environments/tasks.py#build_docker_image]
- [Source: backend/src/execution/runners/docker_runner.py#_build_robot_command]
- [Source: backend/src/governance/dependencies.py#require_package_op]
- [Source: CLAUDE.md#Deployment feature flags (Epic GOV)]
