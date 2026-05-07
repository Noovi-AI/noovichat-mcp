/**
 * Internal Chat — agent-to-agent direct messages and group chats.
 *
 * NooviChat-custom feature.
 * Distinct from customer conversations: this is the staff-only side
 * channel for coordination, with DMs, groups, member management,
 * read tracking and CRUD on chat messages.
 *
 * Routes (Chatwoot/config/routes.rb 170-182):
 *   resources :internal_chats, only: %i[index show update destroy] do
 *     collection do
 *       get :agents
 *       post :dm,     action: :create_dm
 *       post :groups, action: :create_group
 *     end
 *     member do
 *       post   :add_members
 *       delete 'members/:user_id', action: :remove_member, as: :remove_member
 *       post   :mark_read
 *     end
 *     resources :messages, controller: 'internal_chat_messages',
 *               only: %i[index create update destroy]
 *   end
 *
 * Base paths:
 *   /api/v1/accounts/:account_id/internal_chats
 *   /api/v1/accounts/:account_id/internal_chats/:chat_id/messages
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
  pagination,
  agentUserId,
} from "./_helpers.js";

const chatId = z.number().int().positive().describe("Internal chat ID");
const messageIdInput = z.number().int().positive().describe("Internal chat message ID");

export const register: RegisterFn = (server, client) => {
  // ── Chats ──────────────────────────────────────────────────────────────────
  server.registerTool(
    "list_internal_chats",
    {
      title: "List internal chats",
      description:
        "List internal chats (DMs and groups) for the current agent. Includes unread counts and last message preview.",
      inputSchema: { account_id: optionalAccountId, ...pagination },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/internal_chats`, params);
      }),
  );

  server.registerTool(
    "get_internal_chat",
    {
      title: "Get internal chat",
      description: "Read full chat detail including participants, last message and metadata.",
      inputSchema: { account_id: optionalAccountId, chat_id: chatId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, chat_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/internal_chats/${chat_id}`);
      }),
  );

  server.registerTool(
    "list_internal_chat_agents",
    {
      title: "List agents available for internal chat",
      description:
        "List agents in the account who can be added to internal chats (used to populate DM/group create dialogs).",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/internal_chats/agents`);
      }),
  );

  server.registerTool(
    "create_dm",
    {
      title: "Create or fetch a DM",
      description:
        "Open (or reuse) a 1:1 direct message channel with another agent. Idempotent — returns the existing DM if one exists.",
      inputSchema: {
        account_id: optionalAccountId,
        user_id: agentUserId.describe("Agent ID to DM with"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, user_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/internal_chats/dm`, { user_id });
      }),
  );

  server.registerTool(
    "create_group_chat",
    {
      title: "Create group chat",
      description: "Create a named group chat with a list of member agent IDs. The creator is added as a participant.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1).describe("Group chat display name"),
        member_ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Agent (User) IDs to add as members"),
        description: z.string().optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/internal_chats/groups`, body);
      }),
  );

  server.registerTool(
    "update_internal_chat",
    {
      title: "Update internal chat",
      description: "Rename a group chat or update its description. Not applicable to DMs.",
      inputSchema: {
        account_id: optionalAccountId,
        chat_id: chatId,
        name: z.string().optional(),
        description: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, chat_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/internal_chats/${chat_id}`, body);
      }),
  );

  server.registerTool(
    "delete_internal_chat",
    {
      title: "Delete internal chat",
      description:
        "Delete a group chat (admin/creator only) or leave a DM. Messages are removed for all participants.",
      inputSchema: { account_id: accountId, chat_id: chatId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, chat_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/internal_chats/${chat_id}`);
      }),
  );

  // ── Members ────────────────────────────────────────────────────────────────
  server.registerTool(
    "add_chat_members",
    {
      title: "Add members to a group chat",
      description: "Add one or more agents as participants of an existing group chat.",
      inputSchema: {
        account_id: optionalAccountId,
        chat_id: chatId,
        member_ids: z.array(z.number().int().positive()).min(1).describe("Agent IDs to add"),
      },
    },
    async ({ account_id, chat_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/internal_chats/${chat_id}/add_members`, body);
      }),
  );

  server.registerTool(
    "remove_chat_member",
    {
      title: "Remove member from a group chat",
      description: "Remove a single agent from a group chat (DELETE /internal_chats/:chat_id/members/:user_id).",
      inputSchema: {
        account_id: accountId,
        chat_id: chatId,
        user_id: agentUserId,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, chat_id, user_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/internal_chats/${chat_id}/members/${user_id}`);
      }),
  );

  server.registerTool(
    "mark_chat_read",
    {
      title: "Mark internal chat as read",
      description: "Move the read pointer to the latest message in an internal chat.",
      inputSchema: { account_id: optionalAccountId, chat_id: chatId },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, chat_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/internal_chats/${chat_id}/mark_read`);
      }),
  );

  // ── Messages ───────────────────────────────────────────────────────────────
  server.registerTool(
    "list_chat_messages",
    {
      title: "List internal chat messages",
      description: "Paginated list of messages in an internal chat (oldest→newest by default).",
      inputSchema: {
        account_id: optionalAccountId,
        chat_id: chatId,
        before: z.number().int().positive().optional().describe("Return messages with id < this (for back-pagination)"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, chat_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/internal_chats/${chat_id}/messages`, params);
      }),
  );

  server.registerTool(
    "send_chat_message",
    {
      title: "Send internal chat message",
      description: "Send a message into an internal chat. The author is the authenticated agent.",
      inputSchema: {
        account_id: optionalAccountId,
        chat_id: chatId,
        content: z.string().min(1).describe("Message body (supports markdown)"),
        content_type: z
          .enum(["text", "markdown", "system"])
          .optional()
          .describe("Content type (default text)"),
      },
    },
    async ({ account_id, chat_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/internal_chats/${chat_id}/messages`, body);
      }),
  );

  server.registerTool(
    "update_chat_message",
    {
      title: "Update internal chat message",
      description: "Edit the content of a previously sent internal chat message (author only).",
      inputSchema: {
        account_id: optionalAccountId,
        chat_id: chatId,
        message_id: messageIdInput,
        content: z.string().min(1),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, chat_id, message_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/internal_chats/${chat_id}/messages/${message_id}`,
          body,
        );
      }),
  );

  server.registerTool(
    "delete_chat_message",
    {
      title: "Delete internal chat message",
      description: "Delete an internal chat message (author or chat admin only).",
      inputSchema: {
        account_id: accountId,
        chat_id: chatId,
        message_id: messageIdInput,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, chat_id, message_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/internal_chats/${chat_id}/messages/${message_id}`,
        );
      }),
  );
};
