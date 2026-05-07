/**
 * Pipeline Pro — cards (deals/opportunities) and per-card actions.
 *
 * Routes (Chatwoot/config/routes.rb 519-585):
 *   /api/v1/accounts/:account_id/pipeline_cards (top-level CRUD + reorder)
 *   /api/v1/accounts/:account_id/pipelines/:id/pipeline_cards (scoped index)
 *   /api/v1/accounts/:account_id/pipeline/cards/* (namespaced — assign,
 *     deal_status, timeline, restore, permanently_delete, discarded,
 *     bulk_assign, bulk_delete, bulk_set_priority, lead_scores/recalculate
 *     and override, sequences attached to a card)
 *
 * The top-level resource is preferred for create/update/destroy; the
 * namespaced one carries domain-specific actions.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
  customAttributes,
  pagination,
  agentUserId,
} from "./_helpers.js";

const cardId = z.number().int().positive().describe("Pipeline card ID");
const stageId = z.number().int().positive().describe("Pipeline stage ID");
const pipelineIdInput = z.number().int().positive().describe("Pipeline ID");

const dealQualification = z
  .enum(["unqualified", "qualified", "qualified_meeting", "qualified_proposal", "negotiation"])
  .describe("Deal qualification status");

const cardPriority = z.enum(["low", "medium", "high", "urgent"]).describe("Card priority");

export const register: RegisterFn = (server, client) => {
  // ── List & filter ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_cards",
    {
      title: "List pipeline cards",
      description:
        "List cards filtered by pipeline, stage, owner, qualification, status (open/won/lost). Use list_discarded_cards for soft-deleted ones.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput.optional(),
        stage_id: stageId.optional(),
        owner_id: agentUserId.optional(),
        qualification: dealQualification.optional(),
        status: z.enum(["open", "won", "lost"]).optional(),
        contact_id: z.number().int().positive().optional(),
        priority: cardPriority.optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        if (params.pipeline_id) {
          // Scoped under a pipeline (faster — uses pipeline-level cache)
          const { pipeline_id, ...rest } = params;
          return client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}/pipeline_cards`, rest);
        }
        return client.get(`/api/v1/accounts/${acc}/pipeline_cards`, params);
      }),
  );

  server.registerTool(
    "get_card",
    {
      title: "Get pipeline card",
      description:
        "Read the full detail of a card, including contact, conversation, owner, stage, custom_attributes, lead_score, item_details.",
      inputSchema: { account_id: optionalAccountId, card_id: cardId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline_cards/${card_id}`);
      }),
  );

  server.registerTool(
    "list_discarded_cards",
    {
      title: "List discarded (soft-deleted) cards",
      description: "List cards that were soft-deleted (LGPD/GDPR-compliant). Recoverable via restore_card.",
      inputSchema: { account_id: optionalAccountId, ...pagination },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/cards/discarded`, params);
      }),
  );

  // ── Create / update ────────────────────────────────────────────────────────
  server.registerTool(
    "create_card",
    {
      title: "Create pipeline card",
      description: "Create a new card on a stage. Either contact_id or contact_attributes is required.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput,
        pipeline_stage_id: stageId,
        title: z.string().min(1).describe("Card title (e.g., the deal name)"),
        contact_id: z.number().int().positive().optional(),
        contact_attributes: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone_number: z.string().optional(),
          })
          .optional()
          .describe("Inline contact creation (alternative to contact_id)"),
        owner_id: agentUserId.optional().describe("Assign card to an agent"),
        priority: cardPriority.optional(),
        expected_revenue: z.number().optional(),
        scheduled_at: z.string().optional().describe("ISO8601 datetime"),
        deadline: z.string().optional().describe("ISO8601 datetime"),
        tags: z.array(z.string()).optional(),
        qualification_status: dealQualification.optional(),
        custom_attributes: customAttributes,
        item_details: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline_cards`, body);
      }),
  );

  server.registerTool(
    "update_card",
    {
      title: "Update pipeline card",
      description: "Update card fields. Use move_card_to_stage for stage changes (it tracks history).",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        title: z.string().optional(),
        priority: cardPriority.optional(),
        expected_revenue: z.number().optional(),
        scheduled_at: z.string().optional(),
        deadline: z.string().optional(),
        tags: z.array(z.string()).optional(),
        qualification_status: dealQualification.optional(),
        custom_attributes: customAttributes,
        item_details: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline_cards/${card_id}`, body);
      }),
  );

  server.registerTool(
    "delete_card",
    {
      title: "Delete (soft) pipeline card",
      description: "Soft-delete a card (LGPD-compliant). Recoverable via restore_card within retention window.",
      inputSchema: { account_id: accountId, card_id: cardId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline_cards/${card_id}`);
      }),
  );

  // ── Stage transitions / status ─────────────────────────────────────────────
  server.registerTool(
    "move_card_to_stage",
    {
      title: "Move card to stage",
      description: "Move a card to a different stage. Records stage_history and may trigger automations.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        pipeline_stage_id: stageId,
        position: z.number().int().optional().describe("Position within new stage (default: end)"),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline_cards/${card_id}/move_to_stage`, body);
      }),
  );

  server.registerTool(
    "reorder_cards",
    {
      title: "Reorder cards within a stage",
      description: "Reorder cards by passing the target order of card IDs.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_stage_id: stageId,
        card_ids: z.array(z.number().int().positive()).describe("Cards in desired order"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline_cards/reorder`, body);
      }),
  );

  server.registerTool(
    "mark_card_won",
    {
      title: "Mark deal as won",
      description: "Close the card as won. Optionally pass won_value and won_note.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        won_value: z.number().optional(),
        won_note: z.string().optional(),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/deal_status/mark_won`, body);
      }),
  );

  server.registerTool(
    "mark_card_lost",
    {
      title: "Mark deal as lost",
      description: "Close the card as lost. Pass lost_reason to feed lost-reason analytics.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        lost_reason: z.string().optional(),
        lost_note: z.string().optional(),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/deal_status/mark_lost`, body);
      }),
  );

  server.registerTool(
    "reopen_card",
    {
      title: "Reopen won/lost card",
      description: "Reopen a previously closed card (won or lost) and return it to the active flow.",
      inputSchema: { account_id: optionalAccountId, card_id: cardId },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/deal_status/reopen`);
      }),
  );

  // ── Ownership ──────────────────────────────────────────────────────────────
  server.registerTool(
    "assign_card_owner",
    {
      title: "Assign card owner",
      description: "Assign an agent as the owner of a card.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        owner_id: agentUserId.nullable().describe("Pass null to unassign"),
      },
    },
    async ({ account_id, card_id, owner_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/assign`, {
          owner_id,
        });
      }),
  );

  // ── Bulk actions ───────────────────────────────────────────────────────────
  server.registerTool(
    "bulk_assign_cards",
    {
      title: "Bulk assign cards to an owner",
      description: "Reassign multiple cards to a single agent in one call.",
      inputSchema: {
        account_id: optionalAccountId,
        card_ids: z.array(z.number().int().positive()).min(1),
        owner_id: agentUserId.nullable(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/bulk_assign`, body);
      }),
  );

  server.registerTool(
    "bulk_set_card_priority",
    {
      title: "Bulk set card priority",
      description: "Set priority for multiple cards in one call.",
      inputSchema: {
        account_id: optionalAccountId,
        card_ids: z.array(z.number().int().positive()).min(1),
        priority: cardPriority,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline/bulk_actions/set_priority`, body);
      }),
  );

  server.registerTool(
    "bulk_delete_cards",
    {
      title: "Bulk delete (soft) cards",
      description: "Soft-delete multiple cards. Recoverable via restore_card within retention window.",
      inputSchema: {
        account_id: accountId,
        card_ids: z.array(z.number().int().positive()).min(1),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/bulk_actions/delete`, body);
      }),
  );

  // ── Qualification & timeline ───────────────────────────────────────────────
  server.registerTool(
    "update_card_qualification_checklist",
    {
      title: "Update card qualification checklist",
      description: "Update the qualification checklist (BANT/MEDDIC-style) on a card.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        checklist: z.record(z.string(), z.boolean()).describe("Checklist items keyed by name"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, card_id, checklist }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline_cards/${card_id}/update_qualification_checklist`,
          { qualification_checklist: checklist },
        );
      }),
  );

  server.registerTool(
    "get_card_timeline",
    {
      title: "Get card timeline",
      description: "Return the full activity timeline of a card (stage changes, activities, notes, automations).",
      inputSchema: { account_id: optionalAccountId, card_id: cardId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/timeline`);
      }),
  );

  // ── Lead score ─────────────────────────────────────────────────────────────
  server.registerTool(
    "recalculate_card_lead_score",
    {
      title: "Recalculate card lead score",
      description: "Recompute the lead score for a card by re-running all enabled rules.",
      inputSchema: { account_id: optionalAccountId, card_id: cardId },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/lead_scores/recalculate`);
      }),
  );

  server.registerTool(
    "override_card_lead_score",
    {
      title: "Override card lead score",
      description: "Manually set a lead score on a card (bypasses rule engine).",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        score: z.number().int().min(0).describe("Override score value"),
        reason: z.string().optional().describe("Justification for the override"),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/lead_scores/override`, body);
      }),
  );

  // ── GDPR / soft-delete recovery ────────────────────────────────────────────
  server.registerTool(
    "restore_card",
    {
      title: "Restore soft-deleted card",
      description: "Restore a previously soft-deleted card. Use list_discarded_cards to find candidates.",
      inputSchema: { account_id: optionalAccountId, card_id: cardId },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/restore`);
      }),
  );

  server.registerTool(
    "permanently_delete_card",
    {
      title: "Permanently delete card (LGPD/GDPR)",
      description:
        "Hard-delete a card and all related audit logs. IRREVERSIBLE. Use only for LGPD/GDPR compliance.",
      inputSchema: { account_id: accountId, card_id: cardId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/permanently_delete`);
      }),
  );

  // ── Analytics shortcut ─────────────────────────────────────────────────────
  server.registerTool(
    "get_pipeline_analytics_dashboard",
    {
      title: "Get pipeline analytics dashboard",
      description:
        "Return the consolidated pipeline analytics dashboard (win rate, conversion, sales velocity, forecast).",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput.optional(),
        from: z.string().optional().describe("ISO8601 date"),
        to: z.string().optional().describe("ISO8601 date"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/dashboard`, params);
      }),
  );
};
