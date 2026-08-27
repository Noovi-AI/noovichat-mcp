/**
 * Pipeline Pro — cards (deals/opportunities) and per-card actions.
 *
 * Routes (Chatwoot/config/routes.rb 519-585):
 *   /api/v1/accounts/:account_id/pipeline_cards (top-level CRUD + reorder)
 *   /api/v1/accounts/:account_id/pipelines/:id/pipeline_cards (scoped index)
 *   /api/v1/accounts/:account_id/pipeline/cards/* (namespaced — assign,
 *     deal_status, timeline, restore, permanently_delete, discarded,
 *     bulk_assign, bulk_delete, bulk_set_priority, lead_scores/recalculate
 *     and override, sequences attached to a card, and additive non-primary
 *     contacts/conversations links)
 *
 * Additional contacts/conversations (FR2, Chatwoot v4.15.1.12): the singular
 * primary contact (card.contact_id) and conversation (card.conversation_display_id)
 * are UNCHANGED; add_/remove_card_contact and add_/remove_card_conversation
 * manage the additive `additional_contacts` / `additional_conversations` links
 * surfaced on the card's detail response (primary de-duped out).
 *
 * The top-level resource is preferred for create/update/destroy; the
 * namespaced one carries domain-specific actions.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  agentUserId,
  contactId,
  conversationDisplayId,
  customAttributes,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const cardId = z.number().int().positive().describe("Pipeline card ID");
// Stage IDs are strings in Chatwoot — server normalizes to "{pipeline_id}_{slug}"
// after save (e.g. "3321_qualificado"). Was incorrectly typed as z.number()
// before — broke list_cards/move_to_stage with "Invalid arguments" 422.
const stageId = z.string().min(1).describe('Pipeline stage ID (e.g. "3321_qualificado")');
const pipelineIdInput = z.number().int().positive().describe("Pipeline ID");

const cardPriority = z.enum(["none", "low", "medium", "high", "urgent"]).describe("Card priority");

const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code (for example, BRL)")
  .describe("Three-letter uppercase currency code (for example, BRL, USD, or EUR)");

const expectedRevenue = z
  .number()
  .min(0)
  .max(9_999_999_999.99)
  .describe("Expected revenue between 0 and 9,999,999,999.99");

const qualificationCriterion = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    checked: z.boolean().optional(),
    points: z.number().optional(),
    required: z.boolean().optional(),
    category: z.string().optional(),
    checked_at: z.string().nullable().optional(),
    checked_by: z.union([z.number().int().positive(), z.string()]).nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

const qualificationChecklist = z
  .record(z.string(), qualificationCriterion)
  .describe("Qualification criteria keyed by criterion ID");

const cardIndexPagination = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Items per page (default 50, max 500)"),
  cursor: z.string().optional().describe("Opaque cursor returned in meta.next_cursor"),
  offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
};

/**
 * Shared advanced filter fragments accepted by the cards index AND the CSV
 * export endpoint (both backed by the PipelineCardFilterable concern). All
 * optional; passed straight through as query params.
 */
const cardFilters = {
  search: z
    .string()
    .max(200)
    .optional()
    .describe("Search card, contact, owner, inbox, identifier, or stage text (max 200 characters)"),
  labels: z
    .array(z.string())
    .optional()
    .describe("Filter by conversation label titles (OR — matches any)"),
  priority: z.array(cardPriority).min(1).optional().describe("Filter by one or more priorities"),
  value_min: z.number().optional().describe("Minimum expected_revenue/value"),
  value_max: z.number().optional().describe("Maximum expected_revenue/value"),
  agent_id: z
    .union([
      z
        .number()
        .int()
        .refine((value) => value === -1 || value > 0, "Use a positive owner ID or -1"),
      z.literal("unassigned"),
    ])
    .optional()
    .describe("Owner agent ID. Use -1 or 'unassigned' for cards with no owner."),
  date_start: z.string().optional().describe("Created-at range start (YYYY-MM-DD)"),
  date_end: z.string().optional().describe("Created-at range end (YYYY-MM-DD)"),
  sla_exceeded: z.boolean().optional().describe("Only cards whose SLA is overdue"),
  stages: z
    .array(z.string())
    .optional()
    .describe('Filter by one or more stage IDs (e.g. ["3321_lead", "3321_qualificado"])'),
  status: z
    .enum(["open", "won", "lost", "closed"])
    .optional()
    .describe("Deal status; closed includes won and lost cards"),
};

export const register: RegisterFn = (server, client) => {
  // ── List & filter ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_cards",
    {
      title: "List pipeline cards",
      description:
        "List visible cards with the legacy cursor/offset contract. Filters match PipelineCardsController#index; use list_discarded_cards for soft-deleted cards.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput.optional(),
        pipeline_stage: stageId.optional(),
        conversation_display_id: conversationDisplayId.optional(),
        contact_id: contactId.optional(),
        exclude_id: cardId.optional(),
        ...cardFilters,
        ...cardIndexPagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        if (params.pipeline_id) {
          // Scoped under a pipeline (faster — uses pipeline-level cache)
          const { pipeline_id, ...rest } = params;
          return client.get(
            `/api/v1/accounts/${acc}/pipelines/${pipeline_id}/pipeline_cards`,
            rest,
          );
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
      description:
        "List cards that were soft-deleted (LGPD/GDPR-compliant). Recoverable via restore_card.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput.optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/cards/discarded`, params);
      }),
  );

  // ── CSV export / import template ───────────────────────────────────────────
  server.registerTool(
    "export_cards",
    {
      title: "Export pipeline cards to CSV",
      description:
        "Export cards as a CSV file (text/csv, returned as a raw string). Accepts the same filters as list_cards (pipeline, stage, labels, status, priority, value range, agent, created-at range, SLA). Use this for spreadsheet/report extracts.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput.optional(),
        pipeline_stage: stageId.optional(),
        conversation_display_id: conversationDisplayId.optional(),
        contact_id: contactId.optional(),
        exclude_id: cardId.optional(),
        ...cardFilters,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/cards/export`, params);
      }),
  );

  server.registerTool(
    "get_import_template",
    {
      title: "Get pipeline card import CSV template",
      description:
        "Return the CSV template (text/csv, raw string) for bulk-importing cards. Columns: title (required), stage, description, expected_revenue, contact_identifier, contact_email, contact_phone. Fill it and upload via the dashboard import (MCP multipart upload is not yet supported).",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/cards/template`);
      }),
  );

  // ── Create / update ────────────────────────────────────────────────────────
  server.registerTool(
    "create_card",
    {
      title: "Create pipeline card",
      description:
        "Create a new card on a pipeline stage using the legacy pipeline_card wrapper. " +
        "The stage must be a regular one: a card cannot be opened directly in a won/lost " +
        "stage (422) — create it open, then close it with mark_card_won / mark_card_lost.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput,
        // Backend column is `pipeline_stage` (string id like '3321_qualificado').
        // Was incorrectly named `pipeline_stage_id` here — backend silently
        // dropped it via strong_params and validation failed with 422.
        //
        // Since the 2026-08 audit a terminal (won/lost) stage is refused here with
        // 422 `pipeline_stage: requires_deal_transition`: being born closed skipped
        // the closing value and the opportunity ledger entry. update_card has no
        // pipeline_stage at all, and move_card_to_stage goes through move_to_stage,
        // which performs the closing itself — both are unaffected.
        pipeline_stage: stageId,
        position: z.number().int().min(0).optional(),
        conversation_display_id: conversationDisplayId.nullable().optional(),
        contact_id: contactId.nullable().optional(),
        owner_id: agentUserId.nullable().optional().describe("Assign card to an agent"),
        timer_started_at: z.string().nullable().optional(),
        timer_duration: z.number().int().min(0).optional(),
        title: z.string().nullable().optional().describe("Card title (e.g., the deal name)"),
        description: z.string().nullable().optional(),
        priority: cardPriority.optional(),
        expected_revenue: expectedRevenue.nullable().optional(),
        currency: currencyCode.nullable().optional(),
        scheduled_at: z.string().nullable().optional().describe("ISO8601 datetime"),
        deadline: z.string().nullable().optional().describe("ISO8601 datetime"),
        forecast_close_date: z.string().nullable().optional().describe("ISO8601 date"),
        source: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        custom_attributes: customAttributes,
        item_details: z.record(z.string(), z.unknown()).optional(),
        qualification_checklist: qualificationChecklist.optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline_cards`, { pipeline_card: body });
      }),
  );

  server.registerTool(
    "update_card",
    {
      title: "Update pipeline card",
      description:
        "Update card fields. Use move_card_to_stage for stage changes (it tracks history).",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        title: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        priority: cardPriority.optional(),
        expected_revenue: expectedRevenue.nullable().optional(),
        currency: currencyCode.nullable().optional(),
        scheduled_at: z.string().nullable().optional(),
        deadline: z.string().nullable().optional(),
        forecast_close_date: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        custom_attributes: customAttributes,
        item_details: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline_cards/${card_id}`, {
          pipeline_card: body,
        });
      }),
  );

  server.registerTool(
    "delete_card",
    {
      title: "Delete (soft) pipeline card",
      description:
        "Soft-delete a card (LGPD-compliant). Recoverable via restore_card within retention window.",
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
      description:
        "Move a card to a different stage. Records stage_history and may trigger automations. " +
        "Unlike create_card, this tool DOES accept a won/lost stage as the destination: it " +
        "detects the stage type and performs the full closing itself (using lost_reason / " +
        "won_value / won_note when given), so it is the one-call way to move a card and close " +
        "the deal.",
      // Cross-review: the 2026-08 audit closed the generic write path into a
      // won/lost stage, and create_card now says so. Stated only there, an agent
      // reading these descriptions concludes "no stage tool touches a terminal
      // stage" and falls back to mark_card_won for a plain move — the opposite of
      // the contract. The exemption belongs in the description, which is what the
      // model actually reads at call time; the CHANGELOG is not in its context.
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        pipeline_stage: stageId,
        lost_reason: z.string().optional(),
        won_value: expectedRevenue.nullable().optional(),
        won_note: z.string().nullable().optional(),
      },
    },
    // Compare-and-swap: desde a v4.17.0.6 o servidor EXIGE `expected_version` de
    // quem autentica como agent bot, e devolve 409 se alguém moveu o card entre a
    // leitura e a escrita, em vez de sobrescrever calado. Sem o parâmetro, um bot
    // recebe 422 `expected_version_required`.
    //
    // O cabeçalho `api_access_token` resolve para User ou AgentBot conforme o
    // token configurado, então o MCP não sabe de antemão qual contrato vale. Lê o
    // card e manda a versão sempre: para bot é obrigatório, para humano converte
    // "última escrita vence" em conflito detectado. Um GET a mais por movimento é
    // o preço de não sobrescrever o trabalho de uma pessoa.
    //
    // O 409 sobe como veio: repetir com versão nova reproduziria exatamente a
    // sobrescrita que o servidor está recusando.
    async ({ account_id, card_id, ...body }) =>
      safeHandler(async () => {
        const acc = resolveAccountId(account_id);
        const card = (await client.get(`/api/v1/accounts/${acc}/pipeline_cards/${card_id}`)) as {
          stage_version?: number;
        } | null;

        const payload: Record<string, unknown> = { ...body };
        if (card?.stage_version !== undefined && card?.stage_version !== null) {
          payload.expected_version = card.stage_version;
        }

        return client.post(
          `/api/v1/accounts/${acc}/pipeline_cards/${card_id}/move_to_stage`,
          payload,
        );
      }),
  );

  server.registerTool(
    "reorder_cards",
    {
      title: "Reorder cards within a stage",
      description:
        "Set card positions (and their existing stage) inside one pipeline. Each entry must include id, position and pipeline_stage.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineIdInput,
        positions: z
          .array(
            z
              .object({
                id: cardId,
                position: z.number().int().min(0),
                pipeline_stage: stageId,
              })
              .strict(),
          )
          .min(1),
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
        won_value: expectedRevenue.nullable().optional(),
        won_note: z.string().nullable().optional(),
        winning_offer_index: z.number().int().min(0).optional(),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/deal_status/mark_won`,
          body,
        );
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
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/deal_status/mark_lost`,
          body,
        );
      }),
  );

  server.registerTool(
    "reopen_card",
    {
      title: "Reopen won/lost card",
      description:
        "Reopen a previously closed card (won or lost) and return it to the active flow.",
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
        notify: z.boolean().optional().describe("Notify the newly assigned owner"),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/assign`, body);
      }),
  );

  // ── Additional (non-primary) contacts & conversations ─────────────────────
  // Purely additive links. The PRIMARY contact stays pipeline_cards.contact_id
  // and the PRIMARY conversation stays pipeline_cards.conversation_display_id
  // (unchanged, retrocompat). These surface on get_card as
  // `additional_contacts` / `additional_conversations` (primary de-duped out).
  // Routes: Chatwoot/config/routes.rb 706-716 (namespace :pipeline →
  //   resources :cards → resources :contacts/:conversations, only create+destroy).
  server.registerTool(
    "add_card_contact",
    {
      title: "Add an additional contact to a card",
      description:
        "Link an extra (non-primary) contact to a pipeline card. The primary contact (card.contact_id) is unchanged. Returns the link { id, contact_id, name, email, phone_number, avatar_url, role }; the `id` is the link id needed by remove_card_contact.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        contact_id: contactId,
        role: z
          .string()
          .optional()
          .describe("Optional role label for this contact on the card (e.g. 'decision_maker')"),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/contacts`, body);
      }),
  );

  server.registerTool(
    "remove_card_contact",
    {
      title: "Remove an additional contact from a card",
      description:
        "Unlink an additional (non-primary) contact from a card. Pass the link id (the `id` from add_card_contact / the `additional_contacts[].id` on the card), NOT the contact_id. Cannot remove the primary contact.",
      inputSchema: {
        account_id: accountId,
        card_id: cardId,
        id: z.number().int().positive().describe("Pipeline-card-contact link id (not contact_id)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, card_id, id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/contacts/${id}`);
      }),
  );

  server.registerTool(
    "add_card_conversation",
    {
      title: "Add an additional conversation to a card",
      description:
        "Link an extra (non-primary) conversation to a pipeline card. The primary conversation (card.conversation_display_id) is unchanged. Returns the link { id, conversation_display_id }; the `id` is the link id needed by remove_card_conversation.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        conversation_display_id: conversationDisplayId,
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/conversations`, body);
      }),
  );

  server.registerTool(
    "remove_card_conversation",
    {
      title: "Remove an additional conversation from a card",
      description:
        "Unlink an additional (non-primary) conversation from a card. Pass the link id (the `id` from add_card_conversation / the `additional_conversations[].id` on the card), NOT the conversation_display_id. Cannot remove the primary conversation.",
      inputSchema: {
        account_id: accountId,
        card_id: cardId,
        id: z
          .number()
          .int()
          .positive()
          .describe("Pipeline-card-conversation link id (not conversation_display_id)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, card_id, id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/conversations/${id}`,
        );
      }),
  );

  // ── Bulk actions ───────────────────────────────────────────────────────────
  server.registerTool(
    "bulk_assign_cards",
    {
      title: "Bulk assign cards to an owner",
      description:
        "Assign up to 200 cards directly, by round robin or by current workload. " +
        "In direct mode owner_id is required: pass a user id to assign, or null to unassign. " +
        "Omitting it is rejected with 422 — a missing key used to clear every owner in the batch.",
      inputSchema: {
        account_id: optionalAccountId,
        card_ids: z.array(z.number().int().positive()).min(1).max(200),
        owner_id: agentUserId
          .nullable()
          .optional()
          .describe("Required in direct mode (no distribution). Pass null to unassign."),
        distribution: z.enum(["round_robin", "workload_balanced"]).optional(),
      },
    },
    async ({ account_id, card_ids, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // owners#bulk_assign reads `item_ids` (not `card_ids`).
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/bulk_assign`, {
          item_ids: card_ids,
          ...body,
        });
      }),
  );

  server.registerTool(
    "bulk_set_card_priority",
    {
      title: "Bulk set card priority",
      description: "Set priority for multiple cards in one call.",
      inputSchema: {
        account_id: optionalAccountId,
        card_ids: z.array(z.number().int().positive()).min(1).max(500),
        priority: cardPriority,
        pipeline_stage: stageId.optional(),
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
      description:
        "Soft-delete multiple cards. Recoverable via restore_card within retention window.",
      inputSchema: {
        account_id: accountId,
        card_ids: z.array(z.number().int().positive()).min(1).max(500),
        pipeline_stage: stageId.optional(),
        reason: z.string().optional(),
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
        qualification_checklist: qualificationChecklist,
      },
    },
    async ({ account_id, card_id, qualification_checklist }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline_cards/${card_id}/update_qualification_checklist`,
          { qualification_checklist },
        );
      }),
  );

  server.registerTool(
    "get_card_timeline",
    {
      title: "Get card timeline",
      description:
        "Return the full activity timeline of a card (stage changes, activities, notes, automations).",
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
      description:
        "Recompute the lead score for a card by re-running all enabled rules. Returns " +
        "lead_score, lead_score_factors, lead_score_category and three timestamps: " +
        "`lead_score_updated_at` (when the score was computed), `card_updated_at` (when the " +
        "CARD was last updated) and the legacy `updated_at`. On THIS route `updated_at` " +
        "carries the score timestamp, not the card's — read `card_updated_at` when you mean " +
        "the card. Recalculating writes the score columns directly and does NOT bump the " +
        "card's timestamp, so `card_updated_at` normally comes back OLDER than " +
        "`lead_score_updated_at`; that is expected, not a stale read.",
      // R6 (audit 2026-08): this route's `updated_at` always carried
      // lead_score_updated_at, while the legacy /pipeline_cards/:id/recalculate_score
      // route returns the card's. The published meaning was kept so external
      // consumers do not break, and both routes gained the two explicit names.
      // Without this note an agent reads `updated_at` here as the card timestamp —
      // exactly the confusion the backend change set out to end.
      inputSchema: { account_id: optionalAccountId, card_id: cardId },
    },
    async ({ account_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/lead_scores/recalculate`,
        );
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
        score: z.number().int().min(0).max(100).describe("Override score value"),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/lead_scores/override`,
          body,
        );
      }),
  );

  // ── GDPR / soft-delete recovery ────────────────────────────────────────────
  server.registerTool(
    "restore_card",
    {
      title: "Restore soft-deleted card",
      description:
        "Restore a previously soft-deleted card. Use list_discarded_cards to find candidates.",
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
        return client.delete(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/permanently_delete`,
        );
      }),
  );

  // ── Analytics shortcut ─────────────────────────────────────────────────────
  server.registerTool(
    "get_pipeline_analytics_dashboard",
    {
      title: "Get pipeline analytics dashboard",
      description:
        "Return the global visible-pipeline dashboard: win rate, sales velocity, lead distribution, pipeline summary and the applied period.",
      inputSchema: {
        account_id: optionalAccountId,
        start_date: z
          .string()
          .optional()
          .describe("Period start in the account reporting timezone"),
        end_date: z.string().optional().describe("Period end in the account reporting timezone"),
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
