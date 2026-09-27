/**
 * Pipeline Pro — analytics and deal-status (lost reason) reports.
 *
 * Routes (Chatwoot/config/routes.rb, `namespace :pipeline`):
 *   Pipeline::AnalyticsController:
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/win_rate
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/conversion_metrics
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/sales_velocity
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/forecast
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/pipeline_analysis
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/pipeline_dashboard
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/export        (text/csv)
 *     (GET .../analytics/dashboard lives in pipeline-cards.ts as
 *      get_pipeline_analytics_dashboard)
 *   Pipeline::OwnersController:
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/pipeline/:user_id
 *     GET /api/v1/accounts/:account_id/pipeline/analytics/team_pipeline
 *   Pipeline::DealStatusController:
 *     GET /api/v1/accounts/:account_id/pipeline/deal_status/lost_reasons
 *     GET /api/v1/accounts/:account_id/pipeline/deal_status/common_reasons
 *
 * Aggregates are limited to the pipelines the token's user can see
 * (administrators see every pipeline). A `pipeline_id` that does not exist is
 * 404; one the agent cannot see is 403.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { agentUserId, optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const pipelineId = z.number().int().positive().describe("Pipeline ID");

// AnalyticsController#set_date_range / DealStatusController: parsed in the
// account timezone; start is snapped to the beginning of the day and end to
// its end. Default window: last 30 days. start after end → 422.
const periodRange = {
  start_date: z
    .string()
    .optional()
    .describe("Period start (e.g. 2026-09-01), account timezone. Default: 30 days ago"),
  end_date: z
    .string()
    .optional()
    .describe("Period end (e.g. 2026-09-30), account timezone. Default: today"),
};

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "get_pipeline_win_rate",
    {
      title: "Get pipeline win rate",
      description:
        "Win-rate metrics for the period across visible pipelines, or one pipeline with pipeline_id.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId.optional(),
        ...periodRange,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/win_rate`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_sales_velocity",
    {
      title: "Get pipeline sales velocity",
      description:
        "Sales-velocity metrics for the period across visible pipelines, or one pipeline with pipeline_id.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId.optional(),
        ...periodRange,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/sales_velocity`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_forecast",
    {
      title: "Get pipeline revenue forecast",
      description:
        "Forecast of open cards by expected close date from today up to months_ahead: { monthly, total, excluded, warning, period }. " +
        "Open cards without a forecast date are counted in `excluded`, not in the total.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId.optional(),
        months_ahead: z
          .number()
          .int()
          .optional()
          .describe("Months ahead to project (clamped to 1-24; server default when omitted)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/forecast`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_conversion_metrics",
    {
      title: "Get pipeline conversion metrics",
      description: "Stage-to-stage conversion metrics of one pipeline for the period.",
      inputSchema: { account_id: optionalAccountId, pipeline_id: pipelineId, ...periodRange },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/conversion_metrics`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_analysis",
    {
      title: "Get pipeline analysis",
      description:
        "Per-stage analysis of one pipeline for the period (cards parked, average time in stage, conversion to next stage, bottleneck risk).",
      inputSchema: { account_id: optionalAccountId, pipeline_id: pipelineId, ...periodRange },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/pipeline_analysis`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_dashboard",
    {
      title: "Get single-pipeline dashboard",
      description:
        "Dashboard of one pipeline, with a paginated recent-activity feed. date_start and date_end must be sent together (YYYY-MM-DD); omit both for no date filter.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        date_start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("Range start YYYY-MM-DD (requires date_end)"),
        date_end: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("Range end YYYY-MM-DD (requires date_start)"),
        activity_page: z
          .number()
          .int()
          .positive()
          .max(10_000)
          .optional()
          .describe("Activity feed page (default 1)"),
        activity_per_page: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Activity feed page size (default 10, max 50)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/pipeline_dashboard`, params);
      }),
  );

  server.registerTool(
    "export_pipeline_analytics",
    {
      title: "Export pipeline analytics (CSV)",
      description:
        "Return one pipeline's report for the period as CSV text (raw string): KPI rows (totals, won/lost in period, value by currency) followed by per-stage rows.",
      inputSchema: { account_id: optionalAccountId, pipeline_id: pipelineId, ...periodRange },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/export`, params);
      }),
  );

  // ── Owners ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_agent_pipeline_metrics",
    {
      title: "Get an agent's pipeline metrics",
      description:
        "Pipeline metrics of one agent over the cards visible to the token: pipeline, conversion_rate, average_deal_size, won_this_month, forecast.",
      inputSchema: { account_id: optionalAccountId, user_id: agentUserId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, user_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/pipeline/${user_id}`);
      }),
  );

  server.registerTool(
    "get_team_pipeline",
    {
      title: "Get team pipeline",
      description:
        "Per-member pipeline value, deals_count, conversion_rate and hot_leads for every agent/administrator, sorted by pipeline value, with totals and top_performer. Computed over the cards visible to the token.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/analytics/team_pipeline`);
      }),
  );

  // ── Lost reasons ───────────────────────────────────────────────────────────
  server.registerTool(
    "get_lost_reasons_analytics",
    {
      title: "Get lost-reason analytics",
      description: "Breakdown of why deals were lost in the period, across visible pipelines.",
      inputSchema: { account_id: optionalAccountId, ...periodRange },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/deal_status/lost_reasons`, params);
      }),
  );

  server.registerTool(
    "list_common_lost_reasons",
    {
      title: "List common lost reasons",
      description:
        "Return { reasons } — the built-in list of common lost reasons, useful as suggestions for mark_card_lost.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/deal_status/common_reasons`);
      }),
  );
};
