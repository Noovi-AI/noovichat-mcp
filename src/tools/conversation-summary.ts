/**
 * Conversation AI summary (Resumo de conversa por IA) — native Noovi AI feature
 * (NooviChat fase 49-B). The only conversation-scoped tooling in this MCP server,
 * which otherwise stays out of core conversation CRUD by design.
 *
 * Routes (Chatwoot/config/routes.rb, conversations member):
 *   GET  /api/v1/accounts/:account_id/conversations/:id/summary   → { summary, summary_generated_at }
 *   POST /api/v1/accounts/:account_id/conversations/:id/summarize → generates/regenerates, same payload
 *
 * `:id` is the conversation DISPLAY id (the short integer in the dashboard URL),
 * not the internal primary key.
 *
 * ⚠️ Operational authorization: `summarize` requires native Noovi AI credentials
 * configured on the account. When AI is unavailable the endpoint responds with an
 * "AI unavailable" payload; a generation failure returns HTTP 422. safeHandler
 * surfaces both verbatim so the LLM / workflow can react.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const conversationId = z
  .number()
  .int()
  .positive()
  .describe(
    "Conversation DISPLAY id (the short integer in the dashboard URL, not the primary key)",
  );

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "get_conversation_summary",
    {
      title: "Get a conversation's AI summary",
      description:
        "Return the stored AI summary of a conversation and the `summary_generated_at` unix timestamp (null when no summary has been generated yet). Read-only — does not trigger generation; use generate_conversation_summary to (re)create it.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, conversation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/conversations/${conversation_id}/summary`);
      }),
  );

  server.registerTool(
    "generate_conversation_summary",
    {
      title: "Generate a conversation's AI summary",
      description:
        "Generate or regenerate the AI summary of a conversation via native Noovi AI, returning the refreshed { summary, summary_generated_at }. Requires AI credentials on the account — otherwise responds that AI is unavailable; a generation error returns HTTP 422.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationId,
      },
    },
    async ({ account_id, conversation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/summarize`,
          {},
        );
      }),
  );
};
