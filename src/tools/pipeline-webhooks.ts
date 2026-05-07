/**
 * Pipeline Pro — webhooks (managed) and the public token-only webhook endpoint
 * used by n8n/Zapier to trigger pipeline automations.
 *
 * Routes:
 *   /api/v1/accounts/:account_id/pipeline/webhooks  (Chatwoot/config/routes.rb 674-679)
 *     index/show/create/update/destroy
 *     member: POST test, PATCH regenerate_secret
 *
 *   /api/v1/pipeline_automation_webhooks/:token  (Chatwoot/config/routes.rb 786-790)
 *     POST create  — public, token-only, no API key required
 *     member: GET verify
 *
 * The public webhook tools are NOT scoped under account_id — they are
 * account-agnostic at the route level (the token resolves the account
 * server-side). Account-scoped CRUD tools manage the webhook configuration
 * itself.
 *
 * ⚠️  SSRF PROTECTION (since v4.13.0.34, 2026-05-07):
 * The `url` field on webhook create/update is now validated against
 * SsrfProtection — URLs resolving to private/internal IPs (10.x, 192.168.x,
 * 127.x, ::1, 169.254.x AWS metadata, etc.) are rejected with HTTP 422:
 *   { "errors": { "url": ["aponta para endereço privado/interno"] } }
 *
 * The same check is re-applied at dispatch time inside
 * PipelineWebhookDispatchJob (closes DNS-rebinding window). Webhooks pointing
 * to public URLs continue to work unchanged.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const webhookId = z.number().int().positive().describe("Pipeline webhook ID");
const webhookToken = z
  .string()
  .min(1)
  .describe("Public webhook token (URL-safe string from create_pipeline_webhook response)");

const webhookEvent = z
  .enum([
    "card.created",
    "card.updated",
    "card.moved",
    "card.won",
    "card.lost",
    "card.deleted",
    "automation.executed",
    "sequence.started",
    "sequence.completed",
  ])
  .describe("Webhook event name");

export const register: RegisterFn = (server, client) => {
  // ── Managed webhook CRUD (account-scoped) ──────────────────────────────────
  server.registerTool(
    "list_pipeline_webhooks",
    {
      title: "List pipeline webhooks",
      description:
        "List configured webhooks (outbound and inbound trigger tokens). Each entry includes URL, events and enabled state.",
      inputSchema: {
        account_id: optionalAccountId,
        enabled: z.boolean().optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/webhooks`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_webhook",
    {
      title: "Get pipeline webhook",
      description: "Read full detail of a webhook (URL, secret hint, events, last delivery).",
      inputSchema: { account_id: optionalAccountId, webhook_id: webhookId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, webhook_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/webhooks/${webhook_id}`);
      }),
  );

  server.registerTool(
    "create_pipeline_webhook",
    {
      title: "Create pipeline webhook",
      description:
        "Create a webhook. For outbound webhooks set a URL; for inbound triggers omit URL — a token is generated.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        url: z
          .string()
          .url()
          .optional()
          .describe("Outbound delivery URL (omit for inbound trigger)"),
        events: z.array(webhookEvent).min(1).describe("Events that trigger this webhook"),
        enabled: z.boolean().optional(),
        secret: z.string().optional().describe("HMAC secret (auto-generated if omitted)"),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Custom HTTP headers to forward on outbound deliveries"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline/webhooks`, body);
      }),
  );

  server.registerTool(
    "update_pipeline_webhook",
    {
      title: "Update pipeline webhook",
      description: "Update webhook URL, events, enabled flag or headers.",
      inputSchema: {
        account_id: optionalAccountId,
        webhook_id: webhookId,
        name: z.string().optional(),
        url: z.string().url().optional(),
        events: z.array(webhookEvent).optional(),
        enabled: z.boolean().optional(),
        headers: z.record(z.string(), z.string()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, webhook_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/webhooks/${webhook_id}`, body);
      }),
  );

  server.registerTool(
    "delete_pipeline_webhook",
    {
      title: "Delete pipeline webhook",
      description: "Delete a webhook. Existing audit entries are retained.",
      inputSchema: { account_id: accountId, webhook_id: webhookId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, webhook_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/webhooks/${webhook_id}`);
      }),
  );

  // ── Member actions ─────────────────────────────────────────────────────────
  server.registerTool(
    "test_pipeline_webhook",
    {
      title: "Test pipeline webhook",
      description: "Send a synthetic test payload through the webhook and report the response.",
      inputSchema: {
        account_id: optionalAccountId,
        webhook_id: webhookId,
        sample_payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Override the default sample payload"),
      },
    },
    async ({ account_id, webhook_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/webhooks/${webhook_id}/test`, body);
      }),
  );

  server.registerTool(
    "regenerate_webhook_secret",
    {
      title: "Regenerate webhook secret",
      description:
        "Rotate the HMAC signing secret of a webhook. Existing consumers must be updated immediately.",
      inputSchema: { account_id: optionalAccountId, webhook_id: webhookId },
      annotations: { idempotentHint: true, destructiveHint: true },
    },
    async ({ account_id, webhook_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/webhooks/${webhook_id}/regenerate_secret`,
        );
      }),
  );

  // ── Public, token-only endpoints (no account_id, no API key) ───────────────
  server.registerTool(
    "trigger_pipeline_automation_via_webhook",
    {
      title: "Trigger pipeline automation via public webhook",
      description:
        "Public token-scoped endpoint (no API key required). Used by external systems (n8n/Zapier/forms) to fire a pipeline automation. The token resolves the account and webhook configuration server-side.",
      inputSchema: {
        token: webhookToken,
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Free-form JSON body forwarded to the automation as `webhook.body`"),
      },
    },
    async ({ token, payload }) =>
      safeHandler(() =>
        client.post(`/api/v1/pipeline_automation_webhooks/${token}`, payload ?? {}),
      ),
  );

  server.registerTool(
    "verify_pipeline_automation_webhook",
    {
      title: "Verify pipeline automation webhook token",
      description:
        "Public verification endpoint (no API key). Confirms the token is valid and lists which automations it triggers — used by n8n to validate the URL during workflow setup.",
      inputSchema: { token: webhookToken },
      annotations: { readOnlyHint: true },
    },
    async ({ token }) =>
      safeHandler(() => client.get(`/api/v1/pipeline_automation_webhooks/${token}/verify`)),
  );
};
