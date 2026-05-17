/**
 * Pipeline Pro — sequences (cadence engine attached to cards) and the
 * sequence analytics endpoint.
 *
 * Routes (Chatwoot/config/routes.rb 560-569, 656):
 *   /api/v1/accounts/:account_id/pipeline/cards/:card_id/sequences
 *     index/create/destroy + member: PATCH pause / resume / complete_step
 *     collection: POST external_start  (used by n8n/Zapier triggers)
 *
 *   /api/v1/accounts/:account_id/pipeline/sequence_analytics  (GET)
 *
 * Sequences are time-triggered cadences (multi-step WhatsApp/webhook/activity
 * flows). Distinct from pipeline_automations, which are event-triggered.
 *
 * ⚠️  FEATURE FLAG (since v4.13.0.34, 2026-05-07):
 * The `pipeline_sequences` feature flag is independent of `pipeline_board` and
 * gerenciado por SuperAdmin per-account. When the feature is OFF, ALL endpoints
 * in this module return HTTP 403 with body:
 *   { "error": "Pipeline Sequences feature is not enabled for this account" }
 *
 * Tools below surface that 403 verbatim through `safeHandler` so the LLM /
 * n8n workflow can detect the disabled state and fall back gracefully.
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

const cardIdInput = z.number().int().positive().describe("Pipeline card ID");
const cardSequenceId = z
  .number()
  .int()
  .positive()
  .describe("Pipeline card sequence (execution) ID");
const sequenceDefinitionId = z
  .number()
  .int()
  .positive()
  .describe("Pipeline sequence definition ID");

export const register: RegisterFn = (server, client) => {
  // ── Card sequences (executions attached to a card) ─────────────────────────
  server.registerTool(
    "list_card_sequences",
    {
      title: "List sequences attached to a card",
      description:
        "List all sequence executions running on a given pipeline card. Includes status (running, paused, completed) and progress per step.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, card_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences`, params);
      }),
  );

  server.registerTool(
    "start_card_sequence",
    {
      title: "Start a sequence on a card",
      description: "Attach and start a sequence definition on a pipeline card.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        sequence_definition_id: sequenceDefinitionId,
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Variables for step rendering (e.g., scheduled overrides, custom data)"),
      },
    },
    async ({ account_id, card_id, sequence_definition_id, context }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        // card_sequences_controller reads `definition_id` (not sequence_definition_id),
        // and the definition must be an ACTIVE pipeline sequence definition.
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences`, {
          definition_id: sequence_definition_id,
          context,
        });
      }),
  );

  server.registerTool(
    "delete_card_sequence",
    {
      title: "Delete (cancel) a card sequence execution",
      description:
        "Cancel a running sequence execution attached to a card. Pending steps are aborted.",
      inputSchema: {
        account_id: accountId,
        card_id: cardIdInput,
        sequence_id: cardSequenceId,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, card_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences/${sequence_id}`,
        );
      }),
  );

  server.registerTool(
    "pause_card_sequence",
    {
      title: "Pause a card sequence",
      description: "Pause a running sequence on a card. Pending steps wait until resumed.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        sequence_id: cardSequenceId,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, card_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences/${sequence_id}/pause`,
        );
      }),
  );

  server.registerTool(
    "resume_card_sequence",
    {
      title: "Resume a card sequence",
      description: "Resume a previously paused card sequence.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        sequence_id: cardSequenceId,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, card_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences/${sequence_id}/resume`,
        );
      }),
  );

  server.registerTool(
    "complete_sequence_step",
    {
      title: "Complete a sequence step",
      description:
        "Mark the current step of a card sequence as completed (advances to the next step).",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        sequence_id: cardSequenceId,
        outcome: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Step-specific outcome data (e.g., reply received, click tracked)"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, card_id, sequence_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences/${sequence_id}/complete_step`,
          body,
        );
      }),
  );

  server.registerTool(
    "external_start_sequence",
    {
      title: "Externally start a sequence on a card",
      description:
        "Collection-level trigger used by n8n/Zapier/external workflows to start a sequence on a card. Same effect as start_card_sequence but accepts a richer external_payload for traceability.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        sequence_definition_id: sequenceDefinitionId,
        source: z
          .string()
          .optional()
          .describe("External trigger source identifier (e.g., 'n8n:flow-42', 'zapier:zap-7')"),
        external_payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Arbitrary payload forwarded by the external system; stored on the execution"),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences/external_start`,
          body,
        );
      }),
  );

  // ── Sequence analytics (account-wide dashboard) ────────────────────────────
  server.registerTool(
    "get_sequence_analytics",
    {
      title: "Get sequence analytics dashboard",
      description:
        "Aggregated metrics for sequence executions: completion rate, avg duration, drop-off per step, top-performing definitions.",
      inputSchema: {
        account_id: optionalAccountId,
        sequence_definition_id: sequenceDefinitionId.optional(),
        from: z.string().optional().describe("ISO8601 from"),
        to: z.string().optional().describe("ISO8601 to"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/sequence_analytics`, params);
      }),
  );
};
