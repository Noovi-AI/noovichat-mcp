/**
 * Disparo em massa (Broadcasts) — NooviChat custom mass-messaging engine.
 *
 * Distinct from upstream Chatwoot Campaigns. Provides CSV upload, blacklist,
 * anti-block throttling, spintax variations, inbox rotation, per-contact
 * tracking, and follow-ups.
 *
 * Routes (Chatwoot/config/routes.rb 155-169):
 *   /api/v1/accounts/:account_id/broadcasts
 *     - GET    /                        (index)
 *     - GET    /:id                     (show)
 *     - POST   /                        (create)
 *     - PATCH  /:id                     (update — partial when running)
 *     - DELETE /:id                     (destroy)
 *     - POST   /:id/pause
 *     - POST   /:id/resume
 *     - POST   /:id/cancel
 *     - POST   /:id/duplicate
 *     - GET    /:id/contacts            (per-contact delivery status)
 *     - GET    /:id/export              (export results)
 *     - POST   /csv_preview             (collection)
 *     - POST   /contacts_preview        (collection)
 *
 *   /api/v1/accounts/:account_id/broadcast_blacklist_entries
 *     - GET / POST / DELETE only
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  inboxId,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const broadcastId = z.number().int().positive().describe("Broadcast ID");
const blacklistEntryId = z.number().int().positive().describe("Broadcast blacklist entry ID");

const broadcastStatus = z
  .enum(["pending", "running", "paused", "completed", "cancelled", "failed"])
  .describe("Broadcast lifecycle status");

// Backend enum: Broadcast.source_type — csv | tags | kanban
const sourceType = z
  .enum(["csv", "tags", "kanban"])
  .describe(
    "How the contact list is sourced: 'csv' (source_config.csv_rows), " +
      "'tags' (contact tags) or 'kanban' (pipeline filter)",
  );

const rotationMode = z
  .enum(["round_robin", "weighted", "random"])
  .describe("How inboxes are rotated to deliver messages");

const startMode = z.enum(["immediate", "scheduled"]).describe("Start mode for the broadcast");

const broadcastCoreFields = {
  name: z.string().min(1).describe("Broadcast name"),
  description: z.string().optional(),
  source_type: sourceType.optional(),
  source_config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Source-specific config (e.g. csv_rows, kanban filter, label name)"),
  inbox_ids: z.array(inboxId).optional().describe("Inboxes to rotate among"),
  inbox_weights: z
    .record(z.string(), z.number())
    .optional()
    .describe("When rotation_mode=weighted: { inbox_id: weight }"),
  rotation_mode: rotationMode.optional(),
  delay_min_seconds: z.number().int().nonnegative().optional(),
  delay_max_seconds: z.number().int().nonnegative().optional(),
  pause_every_n: z.number().int().positive().optional(),
  pause_duration_seconds: z.number().int().nonnegative().optional(),
  window_start_time: z.string().optional().describe("HH:MM 24h"),
  window_end_time: z.string().optional().describe("HH:MM 24h"),
  allowed_weekdays: z.array(z.number().int().min(0).max(6)).optional().describe("0=Sun .. 6=Sat"),
  // Backend enum: Broadcast.message_type — custom | template
  message_type: z.enum(["custom", "template"]).optional(),
  message_payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Message payload. For message_type='custom' it MUST contain a `messages` " +
        'array, e.g. { messages: [{ type: "text", text: "Olá {{nome}}" }] }. ' +
        "For 'template', pass the template name and parameters.",
    ),
  enable_spintax: z.boolean().optional(),
  enable_follow_up: z.boolean().optional(),
  follow_up_after_hours: z.number().int().nonnegative().optional(),
  follow_up_message: z.string().optional(),
  start_mode: startMode.optional(),
  scheduled_at: z.string().optional().describe("ISO8601 datetime when start_mode=scheduled"),
};

export const register: RegisterFn = (server, client) => {
  // ── List & filter ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_broadcasts",
    {
      title: "List broadcasts",
      description: "List broadcasts ordered by most recent. Filter by status.",
      inputSchema: {
        account_id: optionalAccountId,
        status: broadcastStatus.optional(),
        q: z.string().optional().describe("Partial name match (ILIKE %q%)"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/broadcasts`, params);
      }),
  );

  server.registerTool(
    "get_broadcast",
    {
      title: "Get broadcast",
      description: "Read full detail of a broadcast (config, progress, counters).",
      inputSchema: { account_id: optionalAccountId, broadcast_id: broadcastId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, broadcast_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}`);
      }),
  );

  server.registerTool(
    "get_broadcast_contacts",
    {
      title: "Get broadcast contacts",
      description:
        "List the per-contact delivery status (pending/sent/delivered/failed) for a broadcast.",
      inputSchema: {
        account_id: optionalAccountId,
        broadcast_id: broadcastId,
        status: z
          .enum(["pending", "sending", "sent", "failed", "replied", "blacklisted", "skipped"])
          .optional()
          .describe("Filter contacts by delivery status"),
        q: z.string().optional().describe("Partial phone or name match (ILIKE %q%)"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, broadcast_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}/contacts`, params);
      }),
  );

  // ── Create / update ────────────────────────────────────────────────────────
  server.registerTool(
    "create_broadcast",
    {
      title: "Create broadcast",
      description:
        "Create a new mass-messaging broadcast. Pass source_type with matching source_config (CSV rows, kanban filter, label name).",
      inputSchema: {
        account_id: optionalAccountId,
        ...broadcastCoreFields,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/broadcasts`, { broadcast: body });
      }),
  );

  server.registerTool(
    "update_broadcast",
    {
      title: "Update broadcast",
      description:
        "Update broadcast fields. Most config is editable only while status=pending; once running, only name/description can be changed.",
      inputSchema: {
        account_id: optionalAccountId,
        broadcast_id: broadcastId,
        ...broadcastCoreFields,
        // On update every field is optional — `name` must not be forced
        // (it is required only in broadcastCoreFields for the create path).
        name: z.string().min(1).optional().describe("Broadcast name"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, broadcast_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}`, {
          broadcast: body,
        });
      }),
  );

  // ── Lifecycle actions ──────────────────────────────────────────────────────
  server.registerTool(
    "pause_broadcast",
    {
      title: "Pause broadcast",
      description: "Pause a running broadcast. Pending messages stop sending until resumed.",
      inputSchema: { account_id: optionalAccountId, broadcast_id: broadcastId },
    },
    async ({ account_id, broadcast_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}/pause`);
      }),
  );

  server.registerTool(
    "resume_broadcast",
    {
      title: "Resume broadcast",
      description: "Resume a paused broadcast.",
      inputSchema: { account_id: optionalAccountId, broadcast_id: broadcastId },
    },
    async ({ account_id, broadcast_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}/resume`);
      }),
  );

  server.registerTool(
    "cancel_broadcast",
    {
      title: "Cancel broadcast",
      description:
        "Cancel a broadcast. Already-sent messages remain delivered; remaining queue is dropped.",
      inputSchema: { account_id: accountId, broadcast_id: broadcastId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, broadcast_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}/cancel`);
      }),
  );

  server.registerTool(
    "delete_broadcast",
    {
      title: "Delete broadcast",
      description:
        "Permanently delete a broadcast and its per-contact records. Use cancel_broadcast to stop without removing history.",
      inputSchema: { account_id: accountId, broadcast_id: broadcastId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, broadcast_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}`);
      }),
  );

  server.registerTool(
    "duplicate_broadcast",
    {
      title: "Duplicate broadcast",
      description: "Create a new pending broadcast from an existing one (copies config).",
      inputSchema: { account_id: optionalAccountId, broadcast_id: broadcastId },
    },
    async ({ account_id, broadcast_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}/duplicate`);
      }),
  );

  server.registerTool(
    "export_broadcast",
    {
      title: "Export broadcast",
      description:
        "Export the full per-contact delivery results of a broadcast (typically as CSV).",
      inputSchema: { account_id: optionalAccountId, broadcast_id: broadcastId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, broadcast_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/broadcasts/${broadcast_id}/export`);
      }),
  );

  // ── Broadcast Blacklist ────────────────────────────────────────────────────
  server.registerTool(
    "list_broadcast_blacklist",
    {
      title: "List broadcast blacklist entries",
      description:
        "List blacklisted phone numbers that broadcasts will skip. Optionally filter by partial match.",
      inputSchema: {
        account_id: optionalAccountId,
        q: z.string().optional().describe("Partial phone-number match (ILIKE %q%)"),
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/broadcast_blacklist_entries`, params);
      }),
  );

  server.registerTool(
    "add_to_broadcast_blacklist",
    {
      title: "Add phone to broadcast blacklist",
      description: "Add a phone number to the broadcast blacklist.",
      inputSchema: {
        account_id: optionalAccountId,
        phone_number: z.string().min(1).describe("E.164 phone number"),
        reason: z.string().optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/broadcast_blacklist_entries`, body);
      }),
  );

  server.registerTool(
    "remove_from_broadcast_blacklist",
    {
      title: "Remove phone from broadcast blacklist",
      description: "Remove a blacklist entry by ID.",
      inputSchema: { account_id: accountId, entry_id: blacklistEntryId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, entry_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/broadcast_blacklist_entries/${entry_id}`);
      }),
  );
};
