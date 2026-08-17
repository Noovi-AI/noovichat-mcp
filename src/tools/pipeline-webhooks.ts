/**
 * Pipeline Pro — outbound webhooks (managed) and the separate public,
 * token-only endpoint used by n8n/Zapier to trigger pipeline automations.
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
 * Managed pipeline webhooks always require a public HTTP(S) delivery URL.
 * Their generated secret signs outbound deliveries; it is not the token used
 * by `/pipeline_automation_webhooks/:token`. The public automation tools are
 * not account-scoped because that distinct token resolves the automation and
 * account server-side.
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
import { accountId, optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const webhookId = z.number().int().positive().describe("Pipeline webhook ID");
const webhookToken = z
  .string()
  .min(1)
  .describe("Pipeline automation webhook token embedded in its public webhook URL");

const outboundWebhookUrl = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: "Webhook URL must use HTTP or HTTPS" },
  )
  .describe("Public HTTP(S) delivery URL; private/internal destinations are rejected by NooviChat");

const automationWebhookPayload = z
  .record(z.string(), z.unknown())
  .superRefine((payload, refinement) => {
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 1024 * 1024) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: "payload exceeds 1 MiB",
      });
    }
  });

// Backend enum: PipelineWebhook::AVAILABLE_EVENTS
const webhookEvent = z
  .enum([
    "pipeline_card_created",
    "pipeline_card_updated",
    "pipeline_card_deleted",
    "pipeline_card_stage_changed",
    "pipeline_card_won",
    "pipeline_card_lost",
    "pipeline_card_owner_changed",
    // Único evento que nasce de um relógio, não de uma ação. O payload traz
    // `sla_hours`, `seconds_in_stage` e `stage` além do card: só "estourou" não
    // distingue um minuto de atraso de uma semana parada.
    "pipeline_card_sla_exceeded",
  ])
  .describe("Webhook event name (PipelineWebhook::AVAILABLE_EVENTS)");

export const register: RegisterFn = (server, client) => {
  // ── Managed webhook CRUD (account-scoped) ──────────────────────────────────
  server.registerTool(
    "list_pipeline_webhooks",
    {
      title: "List pipeline webhooks",
      description:
        "List outbound pipeline webhooks ordered newest first. Each entry includes URL, events, active state and delivery metadata.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/webhooks`);
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
        "Create an outbound webhook for all pipelines or one pipeline. NooviChat generates the HMAC signing secret.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1).max(100),
        pipeline_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Pipeline to scope deliveries to; omit or pass null for all pipelines"),
        url: outboundWebhookUrl,
        events: z.array(webhookEvent).min(1).describe("Events that trigger this webhook"),
        // Backend column is `active` (not `enabled`).
        active: z.boolean().optional().describe("Whether the webhook is active (default true)"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:pipeline_webhook)`.
        return client.post(`/api/v1/accounts/${acc}/pipeline/webhooks`, { pipeline_webhook: body });
      }),
  );

  server.registerTool(
    "update_pipeline_webhook",
    {
      title: "Update pipeline webhook",
      description: "Update webhook URL, events or active flag.",
      inputSchema: {
        account_id: optionalAccountId,
        webhook_id: webhookId,
        name: z.string().min(1).max(100).optional(),
        url: outboundWebhookUrl.optional(),
        pipeline_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Pass null to make the webhook account-wide"),
        events: z.array(webhookEvent).min(1).optional(),
        active: z.boolean().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, webhook_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/webhooks/${webhook_id}`, {
          pipeline_webhook: body,
        });
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
      description:
        "Dispatch NooviChat's fixed synthetic test payload using the webhook's first configured event and return the destination status code.",
      inputSchema: { account_id: optionalAccountId, webhook_id: webhookId },
    },
    async ({ account_id, webhook_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/webhooks/${webhook_id}/test`);
      }),
  );

  server.registerTool(
    "regenerate_webhook_secret",
    {
      title: "Regenerate webhook secret",
      description:
        "Rotate the HMAC signing secret of a webhook. Existing consumers must be updated immediately.",
      inputSchema: { account_id: accountId, webhook_id: webhookId },
      annotations: { destructiveHint: true },
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
        "Send an object to a public token-scoped automation endpoint. Keys are available in flow templates as {{ webhook_payload.key }} or {{ payload.key }}. Async flows return 202; a short flow with an HTTP Response action may return its configured response.",
      inputSchema: {
        token: webhookToken,
        payload: automationWebhookPayload
          .optional()
          .describe("Free-form JSON object used as the automation's webhook_payload context"),
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
        "Check whether a public automation token is active. A valid token returns 204 with no body; invalid or inactive tokens return 404 with no body.",
      inputSchema: { token: webhookToken },
      annotations: { readOnlyHint: true },
    },
    async ({ token }) =>
      safeHandler(() => client.get(`/api/v1/pipeline_automation_webhooks/${token}/verify`)),
  );
};
