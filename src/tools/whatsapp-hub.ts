/**
 * WhatsApp Hub (NooviConnect) — NooviChat's native WhatsApp group/channel
 * management layer on top of a NooviConnect-enabled API inbox.
 *
 * These tools expose the "Hub" surface of the dashboard: list connected
 * sessions, browse WhatsApp groups and channels (newsletters), read the
 * aggregated Hub report, create groups and manage participants.
 *
 * IMPORTANT — the inbox is the NooviConnect session: `inbox_id` here is the
 * `:id` member param of the `noovi_connect` resource (the inbox that owns the
 * NooviConnect WhatsApp channel), NOT a separate session id. Use
 * `noovi_connect_list_sessions` first to discover which inbox to act on.
 *
 * Routes (Chatwoot/config/routes.rb 612-640):
 *   /api/v1/accounts/:account_id/noovi_connect
 *     - GET    /                              (index — list sessions)
 *     - GET    /:id/groups                    (list WhatsApp groups)
 *     - GET    /:id/newsletters               (list channels / newsletters)
 *     - GET    /:id/hub_report                (aggregated Hub report)
 *     - POST   /:id/create_group              (create a group)
 *     - GET    /:id/group_participants        (?group_jid=…)
 *     - POST   /:id/add_participants          (group_jid, phones[])
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { inboxId, optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const groupJid = z
  .string()
  .min(1)
  .describe(
    "WhatsApp group JID (e.g. '120363000000000000@g.us'). Obtain it from noovi_connect_list_groups.",
  );

export const register: RegisterFn = (server, client) => {
  // ── Sessions ───────────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_list_sessions",
    {
      title: "WhatsApp Hub: list NooviConnect sessions",
      description:
        "List all NooviConnect WhatsApp sessions of the account (one per NooviConnect-enabled inbox), with connection status, phone number and whether each is working. Use this first to find the inbox_id to act on in the other WhatsApp Hub tools.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect`);
      }),
  );

  // ── Groups ───────────────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_list_groups",
    {
      title: "WhatsApp Hub: list groups",
      description:
        "List the WhatsApp groups of a NooviConnect inbox (each with its JID, name and participant count). Use the JID with noovi_connect_group_participants or noovi_connect_add_participants.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/groups`);
      }),
  );

  server.registerTool(
    "noovi_connect_list_channels",
    {
      title: "WhatsApp Hub: list channels",
      description:
        "List the WhatsApp channels (newsletters) the NooviConnect inbox follows or owns, with JID, name, role and subscriber count.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/newsletters`);
      }),
  );

  server.registerTool(
    "noovi_connect_hub_report",
    {
      title: "WhatsApp Hub: report",
      description:
        "Get the aggregated WhatsApp Hub report for a NooviConnect inbox: counts of groups, channels, participants and broadcasts (active/total). Degrades gracefully to zeros when the provider is unavailable.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/hub_report`);
      }),
  );

  // ── Group management ─────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_create_group",
    {
      title: "WhatsApp Hub: create group",
      description:
        "Create a new WhatsApp group on a NooviConnect inbox with a title and an initial list of participant phone numbers (E.164, digits only).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        title: z.string().min(1).describe("Group title / subject"),
        participants: z
          .array(z.string().min(1))
          .min(1)
          .describe("Initial participant phone numbers (E.164, e.g. '5511999999999')"),
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/create_group`, body);
      }),
  );

  server.registerTool(
    "noovi_connect_group_participants",
    {
      title: "WhatsApp Hub: group participants",
      description:
        "List the participants of a WhatsApp group on a NooviConnect inbox. Requires the group JID (from noovi_connect_list_groups).",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId, group_jid: groupJid },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id, group_jid }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/group_participants`, {
          group_jid,
        });
      }),
  );

  server.registerTool(
    "noovi_connect_add_participants",
    {
      title: "WhatsApp Hub: add participants",
      description:
        "Add one or more phone numbers to an existing WhatsApp group on a NooviConnect inbox. Requires the group JID and the phone numbers (E.164, digits only).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        phones: z
          .array(z.string().min(1))
          .min(1)
          .describe("Phone numbers to add (E.164, e.g. '5511999999999')"),
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/add_participants`,
          body,
        );
      }),
  );
};
