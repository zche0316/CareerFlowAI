# CFS-89 — Local Docker startup validation

Validated on 1 November 2026 using the current working tree, including pre-existing uncommitted changes.

## Failure and fix

The original Dockerfile ran `npm ci` before copying `scripts/generate-client.mjs`. The package postinstall hook therefore failed with `MODULE_NOT_FOUND: /app/scripts/generate-client.mjs`.

The Dockerfile now copies this script before installing dependencies. No unrelated source changes were made for this validation.

## Isolation and reproduction

An isolated Compose configuration at `/tmp/careerflow-container-check.json` was derived from `docker compose config --format json`. It uses project `careerflow-container-check`, app port 8788, database port 55433, a separate database volume, `APP_ORIGIN=http://localhost:8788`, and fixture provider mode with API keys cleared. The existing local service and portable database on 8787/55432 were preserved.

Start/rebuild: `docker compose -f /tmp/careerflow-container-check.json up -d --build`

Stop while retaining validation data: `docker compose -f /tmp/careerflow-container-check.json down`

The temporary configuration is local only and is not part of the source delivery. The repository Compose configuration retains its normal 8787/55432 ports.

## Observed results

- Container dependency installation and Prisma Client generation passed.
- Production frontend build passed.
- Application image built and both containers started; PostgreSQL reported healthy.
- All three Prisma migrations applied successfully to the separate database.
- `GET http://localhost:8788/` returned 200; health returned `status=ok`, `mode=fixture`.
- A fictional QA account registered with 201; authenticated workspace access and CSRF-protected logout returned 200.
- Original service health on 8787 still returned 200.
- `git diff --check` passed.

Build output: `/tmp/careerflow-container-check-build.log`.

## Limits and delivery state

This was a container build/startup and account smoke check, not the full automated suite or a real AI workflow. The optional Python semantic-search path was not exercised. No commit, PR, merge, cloud deployment or submission was performed. The Dockerfile fix remains local; issue-key linkage to a future fix commit/PR is pending. CFS-89 remains open.
