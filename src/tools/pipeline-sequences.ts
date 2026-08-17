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
 * ⚠️  OPERATIONAL ENABLEMENT (since v4.13.0.34, 2026-05-07):
 * `pipeline_sequences` is independent of `pipeline_board` and is managed by
 * SuperAdmin per account as an operational license state, not a plan tier.
 * When the capability is not enabled, ALL endpoints in this module return HTTP 403 with body:
 *   { "error": "Pipeline Sequences feature is not enabled for this account" }
 *
 * Tools below surface that 403 verbatim through `safeHandler` so the LLM /
 * n8n workflow can detect the disabled state and fall back gracefully.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { accountId, optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

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

const externalContextKeys = [
  "trigger_source",
  "metadata",
  "external_id",
  "source_url",
  "notes",
] as const;

const externalSequenceContext = z
  .record(z.string(), z.unknown())
  .superRefine((context, refinement) => {
    const unsupportedKeys = Object.keys(context).filter(
      (key) => !externalContextKeys.includes(key as (typeof externalContextKeys)[number]),
    );
    if (unsupportedKeys.length > 0) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported context keys: ${unsupportedKeys.join(", ")}`,
      });
    }

    if (Buffer.byteLength(JSON.stringify(context), "utf8") > 10_000) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: "context exceeds 10000 bytes",
      });
    }
  })
  .describe(
    "Optional trace context. Accepted keys: trigger_source, metadata, external_id, source_url and notes (maximum 10,000 JSON bytes).",
  );

export const register: RegisterFn = (server, client) => {
  // ── Card sequences (executions attached to a card) ─────────────────────────
  server.registerTool(
    "list_card_sequences",
    {
      title: "List sequences attached to a card",
      description:
        "List every sequence execution attached to a pipeline card, newest first, with status and step progress.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences`);
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
        definition_id: sequenceDefinitionId,
      },
    },
    async ({ account_id, card_id, definition_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences`, {
          definition_id,
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
      },
    },
    async ({ account_id, card_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/sequences/${sequence_id}/complete_step`,
        );
      }),
  );

  server.registerTool(
    "external_start_sequence",
    {
      title: "Externally start a sequence on a card",
      description:
        "Start an active sequence definition through the account-scoped integration endpoint and optionally stamp an allowlisted trace context.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        definition_id: sequenceDefinitionId,
        context: externalSequenceContext.optional(),
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
        "Return daily started/completed/failed counts plus active count, completions today, average completion days and top definitions by starts.",
      inputSchema: {
        account_id: optionalAccountId,
        days_back: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Daily summary window (default 7, maximum 90)"),
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
