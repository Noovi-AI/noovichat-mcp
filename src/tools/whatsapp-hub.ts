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
 * Routes (Chatwoot/config/routes.rb 612-658):
 *   /api/v1/accounts/:account_id/noovi_connect
 *     - GET    /                              (index — list sessions)
 *     - GET    /:id/groups                    (list WhatsApp groups)
 *     - GET    /:id/newsletters               (list channels / newsletters)
 *     - POST   /:id/unfollow_newsletter       (newsletter_id)
 *     - GET    /:id/hub_report                (aggregated Hub report)
 *     - POST   /:id/create_group              (create a group)
 *     - GET    /:id/group_participants        (?group_jid=…)
 *     - GET    /:id/group_invite_link         (?group_jid=…) → { invite_link, invite_code }
 *     - POST   /:id/add_participants          (group_jid, phones[])
 *     - POST   /:id/remove_participants       (group_jid, phones[])
 *     - POST   /:id/promote_participants      (group_jid, phones[])
 *     - POST   /:id/demote_participants       (group_jid, phones[])
 *     - POST   /:id/set_group_name            (group_jid, name)
 *     - POST   /:id/set_group_topic           (group_jid, topic)
 *     - POST   /:id/set_group_photo           (group_jid, photo)
 *     - POST   /:id/set_group_locked          (group_jid, locked)
 *     - POST   /:id/set_group_announce        (group_jid, announce)
 *     - POST   /:id/leave_group               (group_jid)
 *     - POST   /:id/send_poll                 (phone, question, options[], max_answer?)
 *     - POST   /:id/send_location             (phone, latitude, longitude, title?)
 *     - GET    /:id/profile                    (connected account profile)
 *     - POST   /:id/set_profile_status         (status)
 *     - GET    /:id/check_number               (?phone=…)
 *     - GET    /:id/labels                     (WhatsApp Business labels)
 *     - GET    /:id/label_chats                (?label_id=…)
 *     - GET    /:id/group_picture              (?group_jid=…)
 *     - GET    /:id/group_info_from_link       (?link=…)
 *     - POST   /:id/join_group_with_link       (link)
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

const phones = z
  .array(z.string().min(1))
  .min(1)
  .describe("Phone numbers (E.164, digits only, e.g. '5511999999999')");

const phone = z
  .string()
  .min(1)
  .describe("Destination phone number (E.164, digits only, e.g. '5511999999999')");

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
    "noovi_connect_group_invite_link",
    {
      title: "WhatsApp Hub: group invite link",
      description:
        "Get the invite link (and invite code) of a WhatsApp group on a NooviConnect inbox. Requires the group JID. Returns { invite_link, invite_code }.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId, group_jid: groupJid },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id, group_jid }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/group_invite_link`, {
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
        phones,
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

  server.registerTool(
    "noovi_connect_remove_participants",
    {
      title: "WhatsApp Hub: remove participants",
      description:
        "Remove one or more phone numbers from a WhatsApp group on a NooviConnect inbox. Requires the group JID and the phone numbers (E.164, digits only). The session must be a group admin.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        phones,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/remove_participants`,
          body,
        );
      }),
  );

  server.registerTool(
    "noovi_connect_promote_participants",
    {
      title: "WhatsApp Hub: promote participants",
      description:
        "Promote one or more group members to admin on a WhatsApp group of a NooviConnect inbox. Requires the group JID and the phone numbers (E.164, digits only).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        phones,
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/promote_participants`,
          body,
        );
      }),
  );

  server.registerTool(
    "noovi_connect_demote_participants",
    {
      title: "WhatsApp Hub: demote participants",
      description:
        "Demote one or more admins back to regular member on a WhatsApp group of a NooviConnect inbox. Requires the group JID and the phone numbers (E.164, digits only).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        phones,
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/demote_participants`,
          body,
        );
      }),
  );

  // ── Group settings ───────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_set_group_name",
    {
      title: "WhatsApp Hub: set group name",
      description:
        "Update the name (subject) of a WhatsApp group on a NooviConnect inbox. Requires the group JID and the new name.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        name: z.string().min(1).describe("New group name / subject"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/set_group_name`,
          body,
        );
      }),
  );

  server.registerTool(
    "noovi_connect_set_group_topic",
    {
      title: "WhatsApp Hub: set group topic",
      description:
        "Update the topic (description) of a WhatsApp group on a NooviConnect inbox. Requires the group JID; pass an empty topic to clear it.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        topic: z.string().describe("New group topic / description (empty string clears it)"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/set_group_topic`,
          body,
        );
      }),
  );

  server.registerTool(
    "noovi_connect_set_group_photo",
    {
      title: "WhatsApp Hub: set group photo",
      description:
        "Update the picture of a WhatsApp group on a NooviConnect inbox. Requires the group JID and a publicly reachable image URL (the WhatsApp engine fetches it).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        photo: z.string().min(1).describe("Public image URL for the new group picture"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/set_group_photo`,
          body,
        );
      }),
  );

  server.registerTool(
    "noovi_connect_set_group_locked",
    {
      title: "WhatsApp Hub: set group locked",
      description:
        "Toggle the 'only admins can edit group info' setting on a WhatsApp group of a NooviConnect inbox. Requires the group JID and the locked flag.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        locked: z
          .boolean()
          .describe("true = only admins can edit the group's info (name/topic/photo)"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/set_group_locked`,
          body,
        );
      }),
  );

  server.registerTool(
    "noovi_connect_set_group_announce",
    {
      title: "WhatsApp Hub: set group announce",
      description:
        "Toggle the 'only admins can send messages' (announcement) setting on a WhatsApp group of a NooviConnect inbox. Requires the group JID and the announce flag.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        group_jid: groupJid,
        announce: z.boolean().describe("true = only admins can send messages (announcement group)"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/set_group_announce`,
          body,
        );
      }),
  );

  server.registerTool(
    "noovi_connect_leave_group",
    {
      title: "WhatsApp Hub: leave group",
      description:
        "Make the NooviConnect session leave a WhatsApp group. Requires the group JID. This removes the connected number from the group.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId, group_jid: groupJid },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, inbox_id, group_jid }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/leave_group`, {
          group_jid,
        });
      }),
  );

  // ── Channels (newsletters) ─────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_unfollow_newsletter",
    {
      title: "WhatsApp Hub: unfollow channel",
      description:
        "Unfollow a WhatsApp channel (newsletter) on a NooviConnect inbox. Requires the newsletter JID (from noovi_connect_list_channels).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        newsletter_id: z
          .string()
          .min(1)
          .describe("Channel (newsletter) JID, e.g. '1203630000000000@newsletter'"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/unfollow_newsletter`,
          body,
        );
      }),
  );

  // ── Rich messages ──────────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_send_poll",
    {
      title: "WhatsApp Hub: send poll",
      description:
        "Send a poll message from a NooviConnect inbox to a phone number. Requires the phone, a question and at least 2 options.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        phone,
        question: z.string().min(1).describe("Poll question"),
        options: z.array(z.string().min(1)).min(2).describe("Poll options (at least 2)"),
        max_answer: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Max answers per voter (>1 enables multiple-choice; defaults to single-choice)",
          ),
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/send_poll`, body);
      }),
  );

  server.registerTool(
    "noovi_connect_send_location",
    {
      title: "WhatsApp Hub: send location",
      description:
        "Send a location (map pin) message from a NooviConnect inbox to a phone number. Requires the phone, latitude and longitude (decimal degrees).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        phone,
        latitude: z.number().describe("Latitude in decimal degrees"),
        longitude: z.number().describe("Longitude in decimal degrees"),
        title: z.string().optional().describe("Optional location title / label"),
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/send_location`, body);
      }),
  );

  // ── Profile ──────────────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_get_profile",
    {
      title: "WhatsApp Hub: get profile",
      description:
        "Get the connected WhatsApp account profile of a NooviConnect inbox (id, name and picture URL).",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/profile`);
      }),
  );

  server.registerTool(
    "noovi_connect_set_profile_status",
    {
      title: "WhatsApp Hub: set profile status",
      description:
        "Update the connected account's WhatsApp status/about text on a NooviConnect inbox.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        status: z.string().describe("New status/about text"),
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/set_profile_status`,
          body,
        );
      }),
  );

  // ── Validation ───────────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_check_number",
    {
      title: "WhatsApp Hub: check number",
      description:
        "Check whether a phone number has an active WhatsApp account, via a NooviConnect inbox. Useful before messaging or broadcasting.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId, phone },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id, phone: phoneArg }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/check_number`, {
          phone: phoneArg,
        });
      }),
  );

  // ── Labels (WhatsApp Business) ───────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_list_labels",
    {
      title: "WhatsApp Hub: list labels",
      description:
        "List the WhatsApp Business labels of a NooviConnect inbox (id, name, color). Business accounts only; personal accounts return an empty list. Distinct from NooviChat conversation labels.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/labels`);
      }),
  );

  server.registerTool(
    "noovi_connect_list_label_chats",
    {
      title: "WhatsApp Hub: chats by label",
      description:
        "List the chats tagged with a WhatsApp Business label on a NooviConnect inbox. Requires the label id (from noovi_connect_list_labels).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        label_id: z.string().min(1).describe("Label id (from noovi_connect_list_labels)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id, label_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/label_chats`, {
          label_id,
        });
      }),
  );

  // ── Group extras ─────────────────────────────────────────────────────────────
  server.registerTool(
    "noovi_connect_group_picture",
    {
      title: "WhatsApp Hub: group picture",
      description:
        "Get the picture URL of a WhatsApp group on a NooviConnect inbox (null when none). Requires the group JID.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId, group_jid: groupJid },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id, group_jid }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/group_picture`, {
          group_jid,
        });
      }),
  );

  server.registerTool(
    "noovi_connect_group_info_from_link",
    {
      title: "WhatsApp Hub: group info from link",
      description:
        "Preview a WhatsApp group from an invite link (without joining), via a NooviConnect inbox. Requires the invite link.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        link: z.string().min(1).describe("Group invite link (https://chat.whatsapp.com/…)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id, link }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/group_info_from_link`,
          { link },
        );
      }),
  );

  server.registerTool(
    "noovi_connect_join_group_with_link",
    {
      title: "WhatsApp Hub: join group by link",
      description: "Join a WhatsApp group from an invite link, via a NooviConnect inbox.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        link: z.string().min(1).describe("Group invite link (https://chat.whatsapp.com/…)"),
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/noovi_connect/${inbox_id}/join_group_with_link`,
          body,
        );
      }),
  );
};
