# Changelog

All notable changes to `@nooviai/noovichat-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`get_appointment_availability_range`** answers availability for a range of
  days in one call, returning
  `{data:{professional_id,duration_minutes,days:[{date,slots}]}}` from
  `GET /appointments/availability_range`. The rules are identical to
  `get_appointment_availability` because it is the same server-side service
  applied day by day — working hours, buffer, service duration, existing
  appointments (cancelled and no-show do not occupy) and start times already in
  the past. It exists so that covering a week or a month is one request instead
  of seven or forty-two. Every day in the range comes back, including days the
  professional does not work, with an empty `slots` array: an omitted day would
  be indistinguishable from a day with nothing free. `from` and `to` are both
  required, `to` must not precede `from`, and the range must span at most 42
  days.

### Fixed

- **Pipeline cards** now use the exact Rails filter and mutation contracts:
  `pipeline_stage`/`agent_id`, cursor pagination, `pipeline_card` request
  wrappers, structured reorder positions and qualification criteria, the
  `none` priority, bounded bulk operations, and `start_date`/`end_date` for the
  global analytics dashboard.
- **Pipeline sequences** now send `definition_id`, restrict `external_start`
  context to the backend allowlist, omit unsupported pagination/outcome data,
  and expose only the implemented `days_back` analytics filter.
- **Pipeline webhooks** now distinguish managed outbound deliveries from the
  separate public automation trigger. Managed create requires an HTTP(S) URL,
  test uses the server-generated sample, secret rotation is explicitly
  destructive, verify documents its 204/404 no-body contract, and public
  payload variables use `webhook_payload`/`payload`.

### Changed

- **`create_card`** documents that a won/lost stage is refused with 422. The
  backend audit of 2026-08 closed the generic write path into and out of a
  terminal stage, because it left a deal closed without its closing value or
  its opportunity ledger entry. `update_card` never accepted `pipeline_stage`
  and `move_card_to_stage` posts to `move_to_stage` (which performs the
  closing itself), so both are unaffected; `mark_card_won`, `mark_card_lost`
  and `reopen_card` remain the way to change a deal's outcome.
  `move_card_to_stage` now says so in its own description, so an agent does not
  read the `create_card` restriction as a ban on moving cards into a won/lost
  stage.
- **`recalculate_card_lead_score`** documents the response contract. The route
  it calls (`POST /pipeline/cards/:id/lead_scores/recalculate`) gained
  `lead_score_updated_at` (when the score was computed) and `card_updated_at`
  (when the card was last updated). Its `updated_at` was left untouched to
  avoid breaking existing consumers, and on this route that legacy field
  carries the score timestamp — not the card's. Read `card_updated_at` when you
  mean the card; it is the one field with the same meaning on both
  recalculation routes. Recalculating writes the score columns directly and
  leaves the card's own timestamp alone, so `card_updated_at` normally comes
  back older than `lead_score_updated_at`.
- **`create_pipeline_automation` / `update_pipeline_automation`** document the
  flow requirement: an automation the engine cannot execute is refused with
  422 rather than saved as a rule that shows up active and never runs. That
  covers creating one without flow nodes, emptying an existing flow, and
  activating a legacy flowless automation. Deactivating one is still allowed.

## [0.13.0] - 2026-07-02

### Added

- WhatsApp Hub profile, labels and group extras: new tools
  `noovi_connect_get_profile` (connected account profile),
  `noovi_connect_set_profile_status` (about/status text),
  `noovi_connect_check_number` (does a number have WhatsApp),
  `noovi_connect_list_labels` + `noovi_connect_list_label_chats`
  (WhatsApp Business labels — Business accounts only),
  `noovi_connect_group_picture`, `noovi_connect_group_info_from_link`
  (preview a group from an invite link) and
  `noovi_connect_join_group_with_link`. Mirrors the new NooviConnect endpoints
  documented in the Chatwoot OpenAPI and the public WhatsApp Hub docs.

## [0.12.0] - 2026-06-30

### Added

- WhatsApp Hub broadcast to groups (NC-33): `create_broadcast` now accepts
  `source_type='whatsapp_group'` and a `broadcast_targets` array
  (`{ target_kind:'group', provider_jid:'<jid>@g.us', metadata?:{name} }`),
  mirroring the Chatwoot Broadcast `whatsapp_group` source + `broadcast_targets`
  contract. Targets are applied on create (ignored on update).
- WhatsApp Hub group/channel/rich-message coverage (NC-50): new tools
  `noovi_connect_group_invite_link` (returns `{ invite_link, invite_code }`),
  `noovi_connect_remove_participants`, `noovi_connect_promote_participants`,
  `noovi_connect_demote_participants`, `noovi_connect_set_group_name`,
  `noovi_connect_set_group_topic`, `noovi_connect_set_group_photo`,
  `noovi_connect_set_group_locked`, `noovi_connect_set_group_announce`,
  `noovi_connect_leave_group`, `noovi_connect_unfollow_newsletter`,
  `noovi_connect_send_poll` and `noovi_connect_send_location`.

## [0.10.0] - 2026-06-20

### Added

- Follow-up automations: AI content mode and customer-inactivity trigger.
  `create_followup_automation` / `update_followup_automation` now accept
  `content_mode` (`template` | `ai`) and `ai_instruction`; `follow_up_template_id`
  is optional (AI mode generates the message at send time from the instruction +
  conversation history). The trigger enum adds `conversation_inactivity`
  (`trigger_config.inactivity_minutes` — customer silence since their last
  received message). Mirrors the Chatwoot follow-up-automations contract.

## [0.9.0] - 2026-06-20

### Added

- `get_conversation_summary` and `generate_conversation_summary`: the conversation
  AI summary (Resumo de conversa por IA, native Noovi AI — Chatwoot fase 49-B).
  `get_conversation_summary` reads the stored `{ summary, summary_generated_at }`
  (read-only); `generate_conversation_summary` (re)generates it via native Noovi
  AI and returns the refreshed payload. Both take the conversation DISPLAY id.
  `summarize` requires AI credentials on the account; otherwise it responds that
  AI is unavailable (a generation error returns HTTP 422). These are the only
  conversation-scoped tools — the server otherwise stays out of core conversation
  CRUD by design.

## [0.8.0] - 2026-06-17

### Added

- `create_followup_template_item` now supports the `whatsapp_template` step type:
  a follow-up step can reference a Meta-approved WhatsApp template
  (`whatsapp_template_name`, `whatsapp_template_language`,
  `whatsapp_template_namespace`) plus a parameter mapping
  (`whatsapp_template_mapping` — ordered BODY params mapped to follow-up variables
  or literal text). On an official WhatsApp inbox outside the 24h window the step
  sends the approved template; on non-official providers (WAHA/UazAPI) or inside
  the window it sends the `content` plain-text fallback. Additive — existing
  text/media steps are unchanged.

## [0.7.0] - 2026-06-13

### Added

- **Commercial Analysis** tools (`/api/v1/accounts/:id/commercial-analyses`):
  `list_commercial_analyses`, `generate_commercial_analysis` (async — returns
  202 with a report id, or the cached report with `cache_hit`),
  `get_commercial_analysis_status` (poll), `get_commercial_analysis` (full
  9-section report) and `delete_commercial_analysis`. Closes the downstream
  parity gap surfaced by the API-docs audit (2026-06-13). The PDF export is
  intentionally not exposed as a tool (binary payload, not LLM-consumable).
  Requires operational authorization on the NooviChat license/account; a 403 is
  surfaced verbatim when the account is not currently authorized.

## [0.3.1] - 2026-05-17

### Security

- Removed the `noovi-license` module. The NooviChat licensing and operational
  authorization boundary must never be readable or mutable by API clients or
  LLMs. The module registered no tools but carried a roadmap to expose them —
  removed entirely.

### Fixed

A continuous CRUD-lifecycle audit of every dev-testable module found and
fixed a batch of request-contract mismatches:

- **pipeline activities**: member actions (get/update/delete/start/complete/
  cancel/reschedule) are card-scoped — `card_id` was missing, so every one
  404'd. create/update now wrap in `{ activity: ... }` and use the real
  columns (`activity_type`, `duration`, `assigned_to_id`); activityType enum
  corrected.
- **activity templates**: create/update wrap in `{ pipeline_activity_template:
  ... }`; schema realigned to real columns (`activity_type`, `default_content`,
  `default_duration`, `category`, `default_metadata`).
- **pipeline webhooks**: create/update wrap in `{ pipeline_webhook: ... }`;
  `enabled` → `active`; added `pipeline_id`; webhookEvent enum replaced with
  the real `AVAILABLE_EVENTS` (`pipeline_card_created` …).
- **activity sequences**: create/update wrap in `{ pipeline_activity_sequence:
  ... }`.
- **bulk_assign_cards**: sent `card_ids`; the backend reads `item_ids`.
- **create_contact_consent_record**: `source` is now an enum
  (agent | widget | import | api | whatsapp).
- **start_card_sequence**: sent `sequence_definition_id`; the backend reads
  `definition_id`.

## [0.3.0] - 2026-05-17

### Added

- **`get_automation_catalog`** — discovery tool returning the full
  pipeline-automation vocabulary: 18 trigger events, 7 condition types and
  32 cross-feature actions (conversation, contact, pipeline, WhatsApp,
  Captain AI, Google Calendar, tasks, webhooks) with their parameters.
- **`build_automation_flow`** — assembles a valid FlowBuilder graph from a
  simple trigger → conditions → actions description, so an LLM never has to
  hand-write node/connection JSON.
- **`inbox_id`** on `create_pipeline` / `update_pipeline` — link a pipeline
  to an inbox (cards auto-created from that inbox's conversations).
- Server-level `instructions` so MCP clients understand conventions and the
  automation workflow on connect.

### Changed

- `create_pipeline_automation` / `update_pipeline_automation` /
  `validate_automation_flow` now take a structured `flow` schema (typed
  nodes / connections / viewport) instead of an opaque blob.

### Fixed

Bugs surfaced by a full lifecycle audit against a dev NooviChat instance
(raised the lifecycle pass rate from 42/50 to 64/65):

- **`extractErrors` ignored Rails-style error hashes** (`{errors:{field:[…]}}`)
  — every field validation collapsed into a generic "422". Now flattened;
  HTML exception pages are trimmed to their headline.
- **HTTP 204 responses produced an invalid MCP result** — `JSON.stringify`
  of `undefined` broke the result envelope for delete/cancel endpoints.
- **lead-scoring** used `score`/`active`; backend uses `points`/`enabled`
  (silently dropped on create, broke update).
- **`create_followup_automation`** schema rewritten to the real contract
  (`trigger_type`, `follow_up_template_id`, `delay_minutes`, …).
- **`create_pipeline_automation`** missing request wrapper; `flow_definition`
  renamed to `flow`, `enabled` to `active`.
- **`create_followup_template_item`** missing required `item_type`;
  `delay_hours` → `delay_seconds`.
- **broadcasts** `source_type` / `message_type` enums corrected;
  `update_broadcast` no longer forces `name`.

## [0.2.1] - 2026-05-07

### Fixed

Bugs surfaced by a 272-tool batch audit against a dev NooviChat instance:

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
  HTTP 403 when the account is not operationally authorized for
  `pipeline_sequences` (Chatwoot v4.13.0.34 SuperAdmin setting).
- `tools/pipeline-webhooks.ts` JSDoc warns about the SsrfProtection
  rejecting URLs resolving to private/internal IPs with HTTP 422.

### Validated

- Smoke tests against a dev NooviChat instance confirm 31+ list/get tools
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
