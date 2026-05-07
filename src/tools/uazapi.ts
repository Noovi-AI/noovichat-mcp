/**
 * UAZAPI WhatsApp Integration — NooviChat custom inbox channel.
 *
 * Alternative to WAHA. Connect/disconnect/reconnect, pairing code,
 * settings management, automatic chatwoot reconfiguration.
 *
 * Routes (Chatwoot/config/routes.rb 503-514):
 *   /api/v1/accounts/:account_id/uazapi/:id  (where :id = inbox_id of a UazAPI channel)
 *     - GET    /:id/status
 *     - GET    /:id/settings
 *     - PATCH  /:id/settings                  (update_settings)
 *     - POST   /:id/connect
 *     - POST   /:id/reconnect
 *     - POST   /:id/disconnect
 *     - POST   /:id/request_pairing_code
 *     - POST   /:id/reconfigure_chatwoot
 *
 * NOTE: like WAHA, the member key `:id` is the **inbox_id** of an inbox
 * whose channel is a UazAPI channel.
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
  server.registerTool(
    "get_uazapi_status",
    {
      title: "Get UazAPI session status",
      description: "Read the current UazAPI session status for an inbox.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/uazapi/${inbox_id}/status`);
      }),
  );

  server.registerTool(
    "get_uazapi_settings",
    {
      title: "Get UazAPI settings",
      description: "Read the UazAPI inbox settings.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/uazapi/${inbox_id}/settings`);
      }),
  );

  server.registerTool(
    "update_uazapi_settings",
    {
      title: "Update UazAPI settings",
      description: "Update the UazAPI inbox settings.",
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
        return client.patch(`/api/v1/accounts/${acc}/uazapi/${inbox_id}/settings`, {
          settings,
        });
      }),
  );

  server.registerTool(
    "connect_uazapi",
    {
      title: "Connect UazAPI session",
      description: "Initiate the UazAPI session (start authentication).",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/uazapi/${inbox_id}/connect`);
      }),
  );

  server.registerTool(
    "reconnect_uazapi",
    {
      title: "Reconnect UazAPI session",
      description: "Force a reconnect of the UazAPI session.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/uazapi/${inbox_id}/reconnect`);
      }),
  );

  server.registerTool(
    "disconnect_uazapi",
    {
      title: "Disconnect UazAPI session",
      description: "Disconnect (logout) the UazAPI WhatsApp session.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/uazapi/${inbox_id}/disconnect`);
      }),
  );

  server.registerTool(
    "request_uazapi_pairing_code",
    {
      title: "Request UazAPI pairing code",
      description:
        "Request a pairing code (alternative to QR scan) to authenticate the UazAPI session.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        phone_number: z
          .string()
          .min(1)
          .describe("Phone number to receive the pairing code"),
      },
    },
    async ({ account_id, inbox_id, phone_number }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/uazapi/${inbox_id}/request_pairing_code`,
          { phone_number },
        );
      }),
  );

  server.registerTool(
    "reconfigure_uazapi_chatwoot",
    {
      title: "Reconfigure UazAPI Chatwoot integration",
      description:
        "Re-apply the Chatwoot integration configuration on the UazAPI side (webhook URL, secrets, etc.).",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/uazapi/${inbox_id}/reconfigure_chatwoot`,
        );
      }),
  );
};
