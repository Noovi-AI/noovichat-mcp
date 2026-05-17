/**
 * Lead Scoring — configurable rules and analytics for lead qualification.
 *
 * NooviChat-custom feature.
 * Scores are computed per-card and per-contact, evaluated against rules
 * defined per account. Logs trace every score change; reports surface
 * dashboards, distributions, trends, top leads and category transitions.
 *
 * Routes (Chatwoot/config/routes.rb):
 *   resources :lead_score_rules                                       (lines 540-544)
 *     collection: post :create_defaults
 *   namespace :lead_score do                                          (lines 131-141, 547-554)
 *     resources :logs, only: [:index, :show]
 *     resource :reports, only: [] do
 *       get :dashboard
 *       get :distribution
 *       get :trends
 *       get :top_leads
 *       get :category_changes
 *       post :bulk_recalculate
 *     end
 *   end
 *   namespace :pipeline do                                            (line 623)
 *     get 'lead_scores/distribution', to: 'lead_scores#distribution'
 *   end
 *
 * Base paths:
 *   /api/v1/accounts/:account_id/lead_score_rules
 *   /api/v1/accounts/:account_id/lead_score/logs
 *   /api/v1/accounts/:account_id/lead_score/reports/...
 *   /api/v1/accounts/:account_id/pipeline/lead_scores/distribution
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  contactId,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const ruleId = z.number().int().positive().describe("Lead score rule ID");
const logId = z.number().int().positive().describe("Lead score log ID");
const cardIdInput = z.number().int().positive().describe("Pipeline card ID");

const dateRange = {
  from: z.string().optional().describe("ISO8601 date (inclusive lower bound)"),
  to: z.string().optional().describe("ISO8601 date (inclusive upper bound)"),
};

export const register: RegisterFn = (server, client) => {
  // ── Rules CRUD ─────────────────────────────────────────────────────────────
  server.registerTool(
    "list_lead_score_rules",
    {
      title: "List lead score rules",
      description:
        "List all lead-scoring rules for the account. Each rule defines a condition + score delta applied when matched.",
      inputSchema: { account_id: optionalAccountId, ...pagination },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score_rules`, params);
      }),
  );

  server.registerTool(
    "get_lead_score_rule",
    {
      title: "Get lead score rule",
      description: "Read a lead-scoring rule with its conditions, score delta and metadata.",
      inputSchema: { account_id: optionalAccountId, rule_id: ruleId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, rule_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score_rules/${rule_id}`);
      }),
  );

  server.registerTool(
    "create_lead_score_rule",
    {
      title: "Create lead score rule",
      description:
        "Create a lead-scoring rule. Conditions describe when it applies; points is the delta added when matched.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1).describe("Rule name"),
        description: z.string().optional(),
        // event_type is REQUIRED by the backend (validated by LeadScoreRule#event_type
        // inclusion in the allowed-events list). Was missing here — calls returned
        // 422 "Event type can't be blank, Event type is not included in the list".
        event_type: z
          .string()
          .min(1)
          .describe(
            "Backend event that triggers the rule. Allowed values include " +
              "'message_sent', 'message_received', 'conversation_resolved', " +
              "'contact_created', 'card_created', 'card_moved', etc. " +
              "Check the LeadScoreRule model for the full enum.",
          ),
        event_subtype: z.string().optional().describe("Optional event subtype filter"),
        // Backend column is `points` (not `score`) and `enabled` (not `active`).
        // The old names were silently dropped by strong-params on create.
        points: z
          .number()
          .int()
          .describe("Score delta applied when conditions match (can be negative)"),
        conditions: z
          .record(z.string(), z.unknown())
          .describe("Condition tree (operator/operands JSON)"),
        enabled: z.boolean().optional().describe("Whether the rule is enabled (default true)"),
        priority: z.number().int().optional().describe("Evaluation order (lower runs first)"),
        cooldown_minutes: z
          .number()
          .int()
          .optional()
          .describe("Minimum minutes between two applications of this rule"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:lead_score_rule)` — wrap explicitly
        // so the request never depends on Rails implicit parameter-wrapping.
        return client.post(`/api/v1/accounts/${acc}/lead_score_rules`, { lead_score_rule: body });
      }),
  );

  server.registerTool(
    "update_lead_score_rule",
    {
      title: "Update lead score rule",
      description: "Update an existing lead-scoring rule.",
      inputSchema: {
        account_id: optionalAccountId,
        rule_id: ruleId,
        name: z.string().optional(),
        description: z.string().optional(),
        event_type: z.string().optional(),
        event_subtype: z.string().optional(),
        points: z.number().int().optional().describe("Score delta (backend column `points`)"),
        conditions: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean().optional().describe("Whether the rule is enabled (backend `enabled`)"),
        priority: z.number().int().optional(),
        cooldown_minutes: z.number().int().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, rule_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/lead_score_rules/${rule_id}`, {
          lead_score_rule: body,
        });
      }),
  );

  server.registerTool(
    "delete_lead_score_rule",
    {
      title: "Delete lead score rule",
      description: "Delete a lead-scoring rule. Existing score logs are retained for audit.",
      inputSchema: { account_id: accountId, rule_id: ruleId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, rule_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/lead_score_rules/${rule_id}`);
      }),
  );

  server.registerTool(
    "create_default_lead_score_rules",
    {
      title: "Bootstrap default lead score rules",
      description:
        "Create the NooviChat-curated default rule set (engagement, recency, demographic). Useful when bootstrapping a new account.",
      inputSchema: { account_id: accountId },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/lead_score_rules/create_defaults`);
      }),
  );

  // ── Logs ───────────────────────────────────────────────────────────────────
  server.registerTool(
    "list_lead_score_logs",
    {
      title: "List lead score logs",
      description:
        "List score change events. Filter by contact, card or rule to trace why a lead got its current score.",
      inputSchema: {
        account_id: optionalAccountId,
        contact_id: contactId.optional(),
        card_id: cardIdInput.optional(),
        rule_id: ruleId.optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score/logs`, params);
      }),
  );

  server.registerTool(
    "get_lead_score_log",
    {
      title: "Get lead score log entry",
      description:
        "Read a single score-change event with context (matched rule, before/after values, reason).",
      inputSchema: { account_id: optionalAccountId, log_id: logId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, log_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score/logs/${log_id}`);
      }),
  );

  // ── Reports ────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_lead_score_dashboard",
    {
      title: "Get lead score dashboard",
      description:
        "Aggregated dashboard: average score, total leads scored, hot/warm/cold counts, top contributors.",
      inputSchema: { account_id: optionalAccountId, ...dateRange },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score/reports/dashboard`, params);
      }),
  );

  server.registerTool(
    "get_lead_score_distribution",
    {
      title: "Get lead score distribution",
      description: "Distribution of scores across leads (histogram buckets, category breakdown).",
      inputSchema: { account_id: optionalAccountId, ...dateRange },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score/reports/distribution`, params);
      }),
  );

  server.registerTool(
    "get_lead_score_trends",
    {
      title: "Get lead score trends",
      description:
        "Time series of score evolution (daily/weekly/monthly buckets) over a date range.",
      inputSchema: {
        account_id: optionalAccountId,
        granularity: z
          .enum(["day", "week", "month"])
          .optional()
          .describe("Bucket size (default day)"),
        ...dateRange,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score/reports/trends`, params);
      }),
  );

  server.registerTool(
    "get_lead_score_top_leads",
    {
      title: "Get top leads by score",
      description: "Ranked list of leads by current score. Useful for sales prioritization.",
      inputSchema: {
        account_id: optionalAccountId,
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("How many leads to return (default 10)"),
        ...dateRange,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score/reports/top_leads`, params);
      }),
  );

  server.registerTool(
    "get_lead_score_category_changes",
    {
      title: "Get lead score category changes",
      description:
        "Transitions of leads between categories (cold→warm→hot). Useful for spotting heating/cooling trends.",
      inputSchema: { account_id: optionalAccountId, ...dateRange },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/lead_score/reports/category_changes`, params);
      }),
  );

  server.registerTool(
    "bulk_recalculate_lead_scores",
    {
      title: "Bulk recalculate lead scores",
      description:
        "Re-run all enabled rules across the account. Heavy operation — schedules a background job.",
      inputSchema: {
        account_id: accountId,
        scope: z
          .enum(["all", "cards", "contacts"])
          .optional()
          .describe("Limit the scope of recalculation (default all)"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/lead_score/reports/bulk_recalculate`, body);
      }),
  );

  // ── Pipeline-scoped distribution ───────────────────────────────────────────
  server.registerTool(
    "get_pipeline_lead_score_distribution",
    {
      title: "Get pipeline lead score distribution",
      description:
        "Distribution of lead scores limited to pipeline cards (per-pipeline view of /lead_score/reports/distribution).",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: z.number().int().positive().optional(),
        ...dateRange,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/lead_scores/distribution`, params);
      }),
  );
};
