/**
 * Google Calendar — sync of NooviChat pipeline cards with Google Calendar.
 *
 * NooviChat-custom feature, backed by `app/services/google_calendar/`
 * with a circuit breaker to protect against upstream Google outages.
 *
 * IMPORTANT — pipeline cards only, never appointments: every write action
 * below resolves through `set_pipeline_card` (Chatwoot
 * `google_calendar_controller.rb`, `PipelineCard.for_account(...).find(pipeline_card_id)`)
 * — there is no code path for an Appointment record. The reserved
 * compatibility route `POST /appointments/:id/sync_to_google` exists and
 * always returns 501 "Google Calendar sync not yet implemented". Fixed
 * 2026-09-13 after an audit found the previous version of this file
 * describing an `entity_type=appointment` choice, an `appointment_id`
 * param and a `calendar_id` param that the API has never read — every write
 * call with those shapes returned 404 "Pipeline card not found" before any
 * of that logic ran.
 *
 * Routes (Chatwoot/config/routes.rb, `resource :google_calendar` block):
 *   resource :google_calendar, only: [], controller: 'google_calendar' do
 *     post   'sync_to_google'
 *     post   'sync_from_google'
 *     delete 'remove_from_google'
 *     post   'toggle_sync'
 *     post   'bulk_sync'
 *     get    'sync_status'
 *     get    'circuit_status'
 *     post   'circuit_reset'
 *   end
 *
 * Base path: /api/v1/accounts/:account_id/google_calendar/<action>
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { accountId, optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const pipelineCardId = z
  .number()
  .int()
  .positive()
  .describe("Pipeline card ID. Appointments cannot be synced — see file header.");

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "sync_to_google_calendar",
    {
      title: "Sync a pipeline card → Google Calendar",
      description:
        "Push ONE NooviChat pipeline card to Google Calendar (the card must have scheduled_at or deadline_at set). Creates the event on the account's configured calendar and stores the returned event id on the card for future updates. Appointments cannot be synced this way — there is no Google Calendar sync for the Appointment resource yet.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_card_id: pipelineCardId,
      },
      annotations: { idempotentHint: false },
    },
    async ({ account_id, pipeline_card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/sync_to_google`, {
          pipeline_card_id,
        });
      }),
  );

  server.registerTool(
    "sync_from_google_calendar",
    {
      title: "Sync Google Calendar → a pipeline card",
      description:
        "Pull ONE specific Google Calendar event (by google_event_id, on the account's primary calendar — there is no per-call calendar selection) and reconcile it into ONE pipeline card. Not a bulk import and not date-range based — call once per event you want to pull in.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_card_id: pipelineCardId,
        google_event_id: z
          .string()
          .min(1)
          .describe(
            "Google Calendar event ID to pull (required by the API — a blank value returns 400)",
          ),
      },
    },
    async ({ account_id, pipeline_card_id, google_event_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/sync_from_google`, {
          pipeline_card_id,
          google_event_id,
        });
      }),
  );

  server.registerTool(
    "remove_from_google_calendar",
    {
      title: "Remove a pipeline card's synced Google Calendar event",
      description:
        "Delete the Google Calendar event linked to ONE pipeline card. The local pipeline card record is preserved — only the external Google event and the card's stored link to it are removed.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_card_id: pipelineCardId,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, pipeline_card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/google_calendar/remove_from_google`, {
          pipeline_card_id,
        });
      }),
  );

  server.registerTool(
    "toggle_google_calendar_sync",
    {
      title: "Toggle Google Calendar sync for a pipeline card",
      description:
        "Enable or disable Google Calendar sync for ONE pipeline card — this is a per-card flag, not an account-wide setting. Enabling with no existing Google event immediately creates one (equivalent to calling sync_to_google_calendar). Disabling keeps the existing Google event unless remove_from_google is also true.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_card_id: pipelineCardId,
        enabled: z.boolean().describe("true to enable, false to disable"),
        remove_from_google: z
          .boolean()
          .optional()
          .describe(
            "Only consulted when disabling: also delete the card's existing Google event instead of just leaving it orphaned",
          ),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, pipeline_card_id, enabled, remove_from_google }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/toggle_sync`, {
          pipeline_card_id,
          enabled,
          remove_from_google,
        });
      }),
  );

  server.registerTool(
    "bulk_sync_google_calendar",
    {
      title: "Bulk Google Calendar sync/enable/disable for pipeline cards",
      description:
        "Enqueue a background job over pipeline cards — enable sync, disable sync, or push to Google (only cards with scheduled_at/deadline_at are pushed). pipeline_ids filters by PIPELINE (the board) ID, not by individual card ID — omit it to target every card in the account. Returns immediately with the count of cards the job will process; it does not wait for the job to finish.",
      inputSchema: {
        account_id: optionalAccountId,
        sync_action: z
          .enum(["enable", "disable", "sync_to_google"])
          .describe("enable/disable sync, or push scheduled cards to Google now"),
        pipeline_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe(
            "Pipeline (board) IDs to restrict the job to. Omit for every pipeline in the account.",
          ),
      },
    },
    async ({ account_id, sync_action, pipeline_ids }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/bulk_sync`, {
          sync_action,
          pipeline_ids,
        });
      }),
  );

  server.registerTool(
    "get_google_calendar_sync_status",
    {
      title: "Get Google Calendar sync status",
      description:
        "Return sync coverage across the account's pipeline cards: total_items, sync_enabled_count, synced_count, sync_percentage, google_channel_configured (whether the account has an email channel configured), and a nested circuit_breaker block (state, failure_count, opened_at, config). Does not include per-item error detail — see get_google_calendar_circuit_status for that.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/google_calendar/sync_status`);
      }),
  );

  server.registerTool(
    "get_google_calendar_circuit_status",
    {
      title: "Get Google Calendar circuit-breaker status",
      description:
        "Return the circuit-breaker state (state, is_open/is_closed/is_half_open), failure_count against failure_threshold, opened_at, the configured sleep_window_seconds/time_window_seconds, and items_pending_retry (cards currently held back by an open circuit). Useful to diagnose a Google API outage before calling reset_google_calendar_circuit.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/google_calendar/circuit_status`);
      }),
  );

  server.registerTool(
    "reset_google_calendar_circuit",
    {
      title: "Reset Google Calendar circuit-breaker (admin)",
      description:
        "Manually reset the circuit-breaker after fixing the upstream issue, and clear the retry-pending flag from every card that was held back by it. Admin-only; bypasses the automatic recovery delay.",
      inputSchema: { account_id: accountId },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/circuit_reset`);
      }),
  );
};
