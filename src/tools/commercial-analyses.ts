/**
 * Commercial Analysis (Análise Comercial) — AI-generated commercial reports
 * scoped by inbox + date period (NooviChat fase-31, native MIT feature).
 *
 * Routes (Chatwoot/config/routes.rb):
 *   /api/v1/accounts/:account_id/commercial-analyses
 *     index/create/show/destroy
 *     member: GET status, GET export (PDF — not exposed as an MCP tool: binary)
 *
 * Async flow: `generate_commercial_analysis` enqueues and returns HTTP 202 with
 * { id, status: "processing" } (or the cached report with cache_hit:true when a
 * fresh report for the same inbox+period exists — 24h cache, bypass with force).
 * Poll `get_commercial_analysis_status` until status is "completed" (or "failed"),
 * then read the full 9-section report with `get_commercial_analysis`.
 *
 * ⚠️ Operational authorization: requires `commercial_analysis` enabled on the
 * account/license state. When OFF, every endpoint returns HTTP 403; safeHandler
 * surfaces it verbatim so the LLM / workflow can detect the disabled state.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { accountId, optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const reportId = z.number().int().positive().describe("Commercial analysis report ID");
const inboxId = z.number().int().positive().describe("Inbox ID to analyse");
const periodDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .describe("Date in YYYY-MM-DD");

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "list_commercial_analyses",
    {
      title: "List commercial analysis reports",
      description:
        "List the account's commercial analysis reports (most recent first, 20 per page). Optionally filter by inbox_id. Returns the summary of each report (status, counts, period) without the full body.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId.optional(),
        page: z.number().int().positive().optional().describe("Page (20 reports per page)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/commercial-analyses`, params);
      }),
  );

  server.registerTool(
    "generate_commercial_analysis",
    {
      title: "Generate a commercial analysis report",
      description:
        "Enqueue an AI commercial analysis for an inbox over a date period. Returns HTTP 202 with { id, status: 'processing' } — poll get_commercial_analysis_status until 'completed'. A fresh report (<24h) for the same inbox+period is reused (cache_hit:true) unless force=true. Period validation errors return 422; an unknown inbox returns 404.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        period_from: periodDate,
        period_to: periodDate.describe("End date (YYYY-MM-DD), must be >= period_from"),
        force: z.boolean().optional().describe("Bypass the 24h cache and force a fresh generation"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/commercial-analyses`, body);
      }),
  );

  server.registerTool(
    "get_commercial_analysis_status",
    {
      title: "Get commercial analysis status",
      description:
        "Lightweight status poll for a report (processing | completed | failed) plus expires_at. Use after generate_commercial_analysis before reading the full report.",
      inputSchema: {
        account_id: optionalAccountId,
        id: reportId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/commercial-analyses/${id}/status`);
      }),
  );

  server.registerTool(
    "get_commercial_analysis",
    {
      title: "Get a commercial analysis report",
      description:
        "Return the full report including the `report` body with the 9 sections (executive_summary, attendance_analysis, lead_behavior, conversation_quality, objections_and_barriers, trends_and_insights, recommendations, by_inbox, team_analysis).",
      inputSchema: {
        account_id: optionalAccountId,
        id: reportId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/commercial-analyses/${id}`);
      }),
  );

  server.registerTool(
    "delete_commercial_analysis",
    {
      title: "Delete a commercial analysis report",
      description: "Permanently delete a commercial analysis report. Returns 204 (no content).",
      inputSchema: {
        account_id: accountId,
        id: reportId,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/commercial-analyses/${id}`);
      }),
  );
};
