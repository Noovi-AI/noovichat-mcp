# Changelog

All notable changes to `@nooviai/noovichat-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-05-07

### Fixed

Bugs surfaced by a 272-tool batch audit against `chat.dev.nooviai.com`:

- **`stageId` schema was `z.number()` but Chatwoot stage IDs are strings**
  (e.g. `"3321_qualificado"`). Broke `list_cards`, `move_card_to_stage`,
  and any tool taking `stage_id` with the real backend format. Now
  `z.string().min(1)`.
- **`create_card` used `pipeline_stage_id` instead of `pipeline_stage`**
  in the body — strong_params silently dropped it and the card creation
  failed with HTTP 422 "validation failed". Renamed to match the model
  column.
- **`create_lead_score_rule` was missing `event_type` in the schema** —
  backend requires it (LeadScoreRule#event_type inclusion validation),
  calls returned 422 "Event type can't be blank". Added as required
  field with description of allowed values.
- **`delete_company` required `account_id` (no fallback)** — inconsistent
  with every other tool. Now `optionalAccountId` (env var fallback).

### Tested

End-to-end CRUD lifecycle verified in dev for:
- `add_pipeline_stage` / `update_pipeline_stage` / `remove_pipeline_stage`
- `create_company` / `update_company` / `delete_company`
- `create_lead_score_rule` / `delete_lead_score_rule`
- `create_followup_template` / `delete_followup_template`
- `create_pipeline` / `delete_pipeline`
- `create_card` / `delete_card`

130 read-only tools batched: 107 OK (200/401/403/404/422), 23 dev-fixture
mismatches (mostly WAHA/UAZAPI inboxes that don't exist in dev). Real
backend bugs surfaced (HTTP 500 on Captain run_* tools, Google Calendar
circuit, appointments CSV export, captain preferences) — those are
Chatwoot-side issues, tracked separately and beyond this MCP release.

## [0.2.0] - 2026-05-07

### Added

- Three new surgical stage-edit tools that perform GET → merge → PATCH
  atomically, preventing the partial-stages-update destructive pattern
  fixed in Chatwoot v4.13.0.34 (incident 2026-05-07):
  - `update_pipeline_stage` — edit one stage's fields without touching
    other stages.
  - `add_pipeline_stage` — append a new stage to a pipeline.
  - `remove_pipeline_stage` — delete a stage; backend auto-moves cards
    to the first non-terminal stage.

### Changed

- `update_pipeline` no longer accepts `stages` in its schema. To edit
  stages, use the three surgical tools above. This is the documented
  safe path post-incident.
- `tools/pipelines.ts` JSDoc adds the stages-format guidance and the
  rationale for read-modify-write semantics.
- `tools/pipeline-sequences.ts` JSDoc warns that all endpoints return
  HTTP 403 when the per-account `pipeline_sequences` feature flag is
  disabled (Chatwoot v4.13.0.34 SuperAdmin setting).
- `tools/pipeline-webhooks.ts` JSDoc warns about the SsrfProtection
  rejecting URLs resolving to private/internal IPs with HTTP 422.

### Validated

- Smoke tests against `chat.dev.nooviai.com` confirm 31+ list/get tools
  responding correctly (the few HTTP 5xx are pre-existing Chatwoot bugs
  unrelated to this release).

## [0.1.0]

### Added

- Initial release of the NooviChat MCP server.
- ~138 tools across 22 feature modules:
  - Pipeline Pro (cards, stages, automations, sequences, activities, webhooks)
  - Follow-Ups (formerly Scheduled Messages)
  - Atendimentos (appointments, services, professionals, partners)
  - Broadcasts (mass-send WhatsApp campaigns)
  - WhatsApp Templates (custom CRUD over Meta + UAZAPI)
  - WAHA + UAZAPI inbox channel operations
  - Lead Scoring (rules, logs, dashboards)
  - Internal Chat (agent-to-agent)
  - Companies (B2B grouping)
  - Atendimento extensions (LGPD, bulk, consent, forwards, contact merge)
  - Google Calendar sync
  - Captain AI hook (preferences + tasks)
- stdio transport (Claude Desktop / Code / Cursor / VS Code).
- Native Node 20 fetch with `AbortController` timeout.
- Zod inline schemas with `safeHandler` error wrapping.
- Auth via `api_access_token` HTTP header.
- Vitest + Biome + tsup build pipeline.
- MIT License (forked from `fazer-ai/mcp-chatwoot`, original notice preserved).
