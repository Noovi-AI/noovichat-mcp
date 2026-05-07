# Changelog

All notable changes to `@nooviai/noovichat-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
