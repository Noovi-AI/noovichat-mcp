/**
 * Captain AI — native (Noovi::Ai::*) message reports, agent sessions and FAQ
 * suggestions.
 *
 * These three endpoints used to live only in Chatwoot's enterprise/ overlay
 * and answered 404 on NooviChat (self-hosted, DISABLE_ENTERPRISE=true). They
 * were ported to native Noovi::Ai::* controllers and are now real, working
 * routes — this module is the MCP surface for them. See captain-hook.ts for
 * the other Captain surface NooviChat owns (preferences + synchronous tasks).
 *
 * Routes (Chatwoot/config/routes.rb 94-100):
 *   POST /api/v1/accounts/:account_id/captain/message_reports
 *   GET  /api/v1/accounts/:account_id/captain/agent_sessions/:id
 *   GET  /api/v1/accounts/:account_id/captain/faq_suggestions
 *   GET  /api/v1/accounts/:account_id/captain/faq_suggestions/:id
 *   PATCH /api/v1/accounts/:account_id/captain/faq_suggestions/:id
 *   POST /api/v1/accounts/:account_id/captain/faq_suggestions/:id/approve
 *   POST /api/v1/accounts/:account_id/captain/faq_suggestions/:id/dismiss
 *
 * Authorization: every endpoint requires the account to be operationally
 * authorized for `captain_ai` via `require_feature!('captain_ai')`, plus the
 * caller must be able to read the conversation the message belongs to
 * (message_reports, agent_sessions) or the conversations backing a
 * suggestion (faq_suggestions) — same guard as opening the conversation
 * itself, not an admin-only restriction.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const messageId = z.number().int().positive().describe("Message ID");

const faqSuggestionId = z.number().int().positive().describe("FAQ suggestion ID");

const reportReason = z
  .enum([
    "incorrect_information",
    "inappropriate_response",
    "incomplete_response",
    "outdated_information",
    "other",
  ])
  .describe("Why the AI message was flagged");

export const register: RegisterFn = (server, client) => {
  // ── Message reports ────────────────────────────────────────────────────────
  server.registerTool(
    "create_captain_message_report",
    {
      title: "Report a Captain AI message",
      description:
        "Records that an AI-generated message was flagged as problematic. The caller must be able to read the conversation the message belongs to — being a member of the account is not enough on its own.",
      inputSchema: {
        account_id: optionalAccountId,
        message_id: messageId,
        report_reason: reportReason,
        description: z.string().optional().describe("Free-text detail about what was wrong"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/captain/message_reports`, body);
      }),
  );

  // ── Agent sessions ──────────────────────────────────────────────────────────
  server.registerTool(
    "get_captain_agent_session",
    {
      title: "Show the AI session behind a message",
      description:
        "Returns which Captain assistant answered a message, which FAQs/scenarios it drew from, on what model and at what credit cost. `message_id` is the ID of the MESSAGE Captain answered, not of the session itself. 404 when the message has no associated AI session (not every message is one Captain produced).",
      inputSchema: {
        account_id: optionalAccountId,
        message_id: messageId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, message_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/captain/agent_sessions/${message_id}`);
      }),
  );

  // ── FAQ suggestions ─────────────────────────────────────────────────────────
  server.registerTool(
    "list_captain_faq_suggestions",
    {
      title: "List Captain FAQ suggestions",
      description:
        "Lists FAQ suggestions the Captain assistant derived from account conversations, for triage. A non-administrator only sees suggestions backed by conversations they can already read — filtered server-side.",
      inputSchema: {
        account_id: optionalAccountId,
        assistant_id: z.number().int().positive().optional().describe("Filter by Captain assistant"),
        status: z.enum(["open", "approved", "dismissed"]).optional(),
        search: z.string().optional().describe("Case-insensitive match against question or answer"),
        page: z.number().int().positive().optional().describe("Default 1"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/captain/faq_suggestions`, params);
      }),
  );

  server.registerTool(
    "get_captain_faq_suggestion",
    {
      title: "Show a Captain FAQ suggestion",
      description:
        "Returns a FAQ suggestion together with the conversation excerpts (observations) that generated it. Observations are filtered by the same conversation visibility as the list — opening a suggestion is not a side channel into a conversation the caller couldn't otherwise read.",
      inputSchema: {
        account_id: optionalAccountId,
        id: faqSuggestionId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/captain/faq_suggestions/${id}`);
      }),
  );

  server.registerTool(
    "update_captain_faq_suggestion",
    {
      title: "Edit a Captain FAQ suggestion",
      description:
        "Edits the question/answer of a suggestion before approving or dismissing it. Only works while the suggestion is still `open` — an already approved or dismissed one is immutable and this returns 404, not 422.",
      inputSchema: {
        account_id: optionalAccountId,
        id: faqSuggestionId,
        question: z.string().optional(),
        answer: z.string().optional(),
      },
    },
    async ({ account_id, id, ...attrs }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/captain/faq_suggestions/${id}`, {
          faq_suggestion: attrs,
        });
      }),
  );

  server.registerTool(
    "approve_captain_faq_suggestion",
    {
      title: "Approve a Captain FAQ suggestion",
      description:
        "Approves the suggestion, turning it into an indexed assistant response the Captain assistant can use to answer future conversations. Optionally accepts an edited question/answer in the same call. Only works while the suggestion is still `open`.",
      inputSchema: {
        account_id: optionalAccountId,
        id: faqSuggestionId,
        question: z.string().optional(),
        answer: z.string().optional(),
      },
    },
    async ({ account_id, id, question, answer }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        const body =
          question !== undefined || answer !== undefined
            ? { faq_suggestion: { question, answer } }
            : {};
        return client.post(`/api/v1/accounts/${acc}/captain/faq_suggestions/${id}/approve`, body);
      }),
  );

  server.registerTool(
    "dismiss_captain_faq_suggestion",
    {
      title: "Dismiss a Captain FAQ suggestion",
      description:
        "Discards the suggestion without creating an assistant response. Only works while the suggestion is still `open`.",
      inputSchema: {
        account_id: optionalAccountId,
        id: faqSuggestionId,
      },
    },
    async ({ account_id, id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/captain/faq_suggestions/${id}/dismiss`, {});
      }),
  );
};
