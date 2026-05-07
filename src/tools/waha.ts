/**
 * WAHA WhatsApp Integration — NooviChat custom inbox channel.
 *
 * Self-hosted WhatsApp HTTP API gateway. QR/pairing code flows, session
 * management, sync messages/contacts/chats, settings split into chatwoot_app /
 * session / webhook scopes.
 *
 * Routes (Chatwoot/config/routes.rb 481-498):
 *   /api/v1/accounts/:account_id/waha/:id  (where :id = inbox_id of a WAHA channel)
 *     - GET    /:id/status
 *     - POST   /:id/refresh_qr
 *     - POST   /:id/request_pairing_code
 *     - POST   /:id/reconnect
 *     - POST   /:id/disconnect
 *     - POST   /:id/stop
 *     - POST   /:id/start
 *     - GET    /:id/settings
 *     - PATCH  /:id/settings/chatwoot_app   (update_chatwoot_app_settings)
 *     - PATCH  /:id/settings/session        (update_session_settings)
 *     - PATCH  /:id/settings/webhook        (update_webhook_settings)
 *     - POST   /:id/pull_messages
 *     - POST   /:id/pull_contacts
 *     - POST   /:id/pull_chats
 *
 * NOTE: the member key is the **inbox_id** of an inbox whose channel is a
 * WAHA WhatsApp channel (`set_inbox` resolves `Current.account.inboxes.find(params[:id])`).
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  optionalAccountId,
  resolveAccountId,
  safeHandler,
  inboxId,
} from "./_helpers.js";

export const register: RegisterFn = (server, client) => {
  // ── Status / connection diagnostics ────────────────────────────────────────
  server.registerTool(
    "get_waha_status",
    {
      title: "Get WAHA session status",
      description:
        "Read current session state (status, QR code, phone number, instance config) for a WAHA inbox.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/waha/${inbox_id}/status`);
      }),
  );

  server.registerTool(
    "refresh_waha_qr",
    {
      title: "Refresh WAHA QR code",
      description: "Trigger a fresh QR-code fetch from the WAHA backend.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/refresh_qr`);
      }),
  );

  server.registerTool(
    "request_waha_pairing_code",
    {
      title: "Request WAHA pairing code",
      description:
        "Request a pairing code (alternative to QR scan) for a phone number to authenticate the WAHA session.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        phone_number: z
          .string()
          .min(1)
          .describe("Phone number (digits only — non-digits are stripped server-side)"),
      },
    },
    async ({ account_id, inbox_id, phone_number }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/request_pairing_code`, {
          phone_number,
        });
      }),
  );

  // ── Session lifecycle ──────────────────────────────────────────────────────
  server.registerTool(
    "reconnect_waha",
    {
      title: "Reconnect WAHA session",
      description: "Force the WAHA backend to reconnect the session.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/reconnect`);
      }),
  );

  server.registerTool(
    "disconnect_waha",
    {
      title: "Disconnect WAHA session",
      description: "Disconnect (logout) the WAHA WhatsApp session.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/disconnect`);
      }),
  );

  server.registerTool(
    "start_waha_session",
    {
      title: "Start WAHA session",
      description: "Boot the WAHA session (after a stop or initial creation).",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/start`);
      }),
  );

  server.registerTool(
    "stop_waha_session",
    {
      title: "Stop WAHA session",
      description: "Stop the WAHA session without logging out (session can be re-started).",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/stop`);
      }),
  );

  // ── Settings ───────────────────────────────────────────────────────────────
  server.registerTool(
    "get_waha_settings",
    {
      title: "Get WAHA settings",
      description:
        "Read the WAHA inbox settings (split into chatwoot_app/session/webhook scopes).",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/waha/${inbox_id}/settings`);
      }),
  );

  server.registerTool(
    "update_waha_chatwoot_app_settings",
    {
      title: "Update WAHA chatwoot_app settings",
      description:
        "Update the chatwoot_app-scoped WAHA settings (locale, default behaviours that affect Chatwoot integration).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        settings: z.record(z.string(), z.unknown()).describe("Settings object to merge"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, settings }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/waha/${inbox_id}/settings/chatwoot_app`,
          { settings },
        );
      }),
  );

  server.registerTool(
    "update_waha_session_settings",
    {
      title: "Update WAHA session settings",
      description:
        "Update the session-scoped WAHA settings (engine, persistence, presence, anti-block knobs).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        settings: z.record(z.string(), z.unknown()),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, settings }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/waha/${inbox_id}/settings/session`, {
          settings,
        });
      }),
  );

  server.registerTool(
    "update_waha_webhook_settings",
    {
      title: "Update WAHA webhook settings",
      description: "Update the webhook-scoped WAHA settings (URL, events, retry policy).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        settings: z.record(z.string(), z.unknown()),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, settings }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/waha/${inbox_id}/settings/webhook`, {
          settings,
        });
      }),
  );

  // ── Pull (manual sync from WAHA backend) ───────────────────────────────────
  server.registerTool(
    "pull_waha_messages",
    {
      title: "Pull WAHA messages",
      description: "Trigger a manual sync of historical messages from the WAHA backend.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/pull_messages`);
      }),
  );

  server.registerTool(
    "pull_waha_contacts",
    {
      title: "Pull WAHA contacts",
      description: "Trigger a manual sync of contacts from the WAHA backend.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/pull_contacts`);
      }),
  );

  server.registerTool(
    "pull_waha_chats",
    {
      title: "Pull WAHA chats",
      description: "Trigger a manual sync of chats from the WAHA backend.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/waha/${inbox_id}/pull_chats`);
      }),
  );
};
