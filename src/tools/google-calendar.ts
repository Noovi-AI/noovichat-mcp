/**
 * Google Calendar — bi-directional sync of NooviChat appointments and
 * pipeline cards with Google Calendar.
 *
 * NooviChat-custom feature, backed by `app/services/google_calendar/`
 * with a circuit breaker to protect against upstream Google outages.
 *
 * Routes (Chatwoot/config/routes.rb 683-692):
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

const syncEntityType = z
  .enum(["appointment", "pipeline_card"])
  .describe("Which NooviChat entity to sync");

const externalEventId = z.string().min(1).describe("Google Calendar event ID");

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "sync_to_google_calendar",
    {
      title: "Sync NooviChat → Google Calendar",
      description:
        "Push a NooviChat appointment or scheduled pipeline card to Google Calendar. Creates the event on the linked calendar and stores the external_event_id for future updates.",
      inputSchema: {
        account_id: optionalAccountId,
        entity_type: syncEntityType,
        appointment_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Required when entity_type=appointment"),
        pipeline_card_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Required when entity_type=pipeline_card (card must have scheduled_at)"),
        calendar_id: z
          .string()
          .optional()
          .describe("Target Google calendar ID (defaults to primary)"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/sync_to_google`, body);
      }),
  );

  server.registerTool(
    "sync_from_google_calendar",
    {
      title: "Sync Google Calendar → NooviChat",
      description:
        "Pull events from a Google calendar and reconcile them into NooviChat appointments. Useful to surface external bookings inside NooviChat.",
      inputSchema: {
        account_id: optionalAccountId,
        calendar_id: z
          .string()
          .optional()
          .describe("Source Google calendar ID (defaults to primary)"),
        from: z.string().optional().describe("ISO8601 lower bound for events to import"),
        to: z.string().optional().describe("ISO8601 upper bound for events to import"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/sync_from_google`, body);
      }),
  );

  server.registerTool(
    "remove_from_google_calendar",
    {
      title: "Remove a synced event from Google Calendar",
      description:
        "Delete the external Google Calendar event linked to a NooviChat entity. Local NooviChat record is preserved.",
      inputSchema: {
        account_id: accountId,
        external_event_id: externalEventId,
        calendar_id: z
          .string()
          .optional()
          .describe("Calendar holding the event (defaults to primary)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, external_event_id, calendar_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/google_calendar/remove_from_google`, {
          external_event_id,
          calendar_id,
        });
      }),
  );

  server.registerTool(
    "toggle_google_calendar_sync",
    {
      title: "Toggle Google Calendar sync",
      description:
        "Enable or disable automatic Google Calendar sync for the account. When disabled, manual sync_* calls still work but listeners stop firing.",
      inputSchema: {
        account_id: optionalAccountId,
        enabled: z.boolean().describe("true to enable, false to disable"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, enabled }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/toggle_sync`, { enabled });
      }),
  );

  server.registerTool(
    "bulk_sync_google_calendar",
    {
      title: "Bulk sync to Google Calendar",
      description:
        "Sync many NooviChat entities to Google Calendar in one call. Ideal for back-filling after enabling sync or recovering from a circuit-open period.",
      inputSchema: {
        account_id: optionalAccountId,
        entity_type: syncEntityType,
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Appointment or pipeline card IDs to sync"),
        calendar_id: z.string().optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/bulk_sync`, body);
      }),
  );

  server.registerTool(
    "get_google_calendar_sync_status",
    {
      title: "Get Google Calendar sync status",
      description:
        "Return the current sync state: enabled flag, last successful/failed sync timestamps, recent error count, pending items.",
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
        "Return the circuit-breaker state (closed/open/half_open), failure counters and next retry timestamp. Useful to diagnose Google API outages.",
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
        "Manually reset the circuit-breaker after fixing the upstream issue. Admin-only; bypasses the automatic recovery delay.",
      inputSchema: { account_id: accountId },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/google_calendar/circuit_reset`);
      }),
  );
};
