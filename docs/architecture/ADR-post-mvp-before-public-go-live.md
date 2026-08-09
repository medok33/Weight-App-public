# ADR: Post-MVP work before public MVP go-live

**Status:** Accepted  
**Date:** 2026-07-22  
**Related steps:** STEP_172–176, STEP_177+

## Context

STEP_172–174 were initially marked DONE after shipping plan/freeze APIs. That overstated release readiness: there is no immutable production Release Candidate artifact set, and no production deployment has been authorized.

## Decision

1. **STEP_172 = PARTIAL** — only an in-process / API `release-candidate/freeze` helper exists. Missing for DONE: stable `releaseId`, annotated git tag, build artifact / image digest, checksum, reproducible rebuild of the same RC. The freeze API landed in the same commit as Pantry (`fb27f82`), so it must not be treated as an MVP-only RC.
2. **STEP_173 = BLOCKED** — reason `EXPLICIT_GO_LIVE_APPROVAL_REQUIRED`. `POST /observability/mvp-deploy/plan` is planning only; production deploy is forbidden without owner approval.
3. **STEP_174 = BLOCKED** — blocked by STEP_173. Local `health/live` / `health/ready` must not be counted as post-release verification.
4. **STEP_175–176 = DONE** — Pantry models, migration `159_pantry`, API, UI, expiry classification and tests meet acceptance.
5. **Roadmap:** Post-MVP feature work (**STEP_177+**) may continue before public MVP deployment. STEP_173–174 remain release gates and require explicit owner approval before any production publish.

## Consequences

- Do not create production tags, images, or deploy from agent automation without owner GO.
- Do not use production credentials.
- Resume feature development at **STEP_177** while 172 stays PARTIAL and 173–174 stay BLOCKED.
