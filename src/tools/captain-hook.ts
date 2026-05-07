/**
 * Captain AI — NooviChat-side hook surface only.
 *
 * Captain AI's core (assistants, copilot, documents, scenarios, custom_tools,
 * bulk_actions) is upstream Chatwoot Enterprise and intentionally OUT OF SCOPE
 * for the NooviChat MCP. We expose only the two pieces that NooviChat itself
 * owns:
 *
 *   1. The account-level Captain "preferences" controller — feature flags
 *      and per-feature model selection (custom NooviChat customization on
 *      top of upstream's `account.captain_preferences`).
 *   2. The "tasks" controller — five immediate-execution AI operations
 *      (rewrite, summarize, reply suggestion, label suggestion, follow-up).
 *      This is a custom NooviChat controller, not the upstream Captain
 *      `tasks` (there is no CRUD; each action runs synchronously and
 *      returns the AI message).
 *
 * Routes (Chatwoot/config/routes.rb 65-93):
 *   GET    /api/v1/accounts/:account_id/captain/preferences
 *   PATCH  /api/v1/accounts/:account_id/captain/preferences
 *   POST   /api/v1/accounts/:account_id/captain/tasks/rewrite
 *   POST   /api/v1/accounts/:account_id/captain/tasks/summarize
 *   POST   /api/v1/accounts/:account_id/captain/tasks/reply_suggestion
 *   POST   /api/v1/accounts/:account_id/captain/tasks/label_suggestion
 *   POST   /api/v1/accounts/:account_id/captain/tasks/follow_up
 *
 * Authorization: every endpoint requires `captain_ai` feature flag enabled
 * via `require_feature!('captain_ai')` and the operating user must have a
 * valid Pundit policy for `captain/tasks` / Account update for preferences.
 *
 * NOT registered here (and why):
 *   - pipeline_run_captain_ai → there is no direct REST endpoint for this.
 *     The action `call_captain_ai_action` is invoked from inside a pipeline
 *     automation step. To trigger it from the MCP, use
 *     `run_pipeline_automation` (in pipeline-automations.ts) on an
 *     automation whose flow includes a Captain AI action.
 *   - list_captain_tasks / get_captain_task / create_captain_task /
 *     update_captain_task / cancel_captain_task → the upstream `tasks`
 *     route in Chatwoot is a singular `resource :tasks` exposing only the
 *     five action endpoints above; there is no underlying Task model with
 *     CRUD. Each "task" action runs synchronously and returns the answer.
 *     We expose the five actions as `run_captain_*` tools instead.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
  conversationDisplayId,
} from "./_helpers.js";

const captainModelKeys = z
  .object({
    editor: z.string().optional(),
    assistant: z.string().optional(),
    copilot: z.string().optional(),
    label_suggestion: z.string().optional(),
    audio_transcription: z.string().optional(),
    help_center_search: z.string().optional(),
  })
  .describe("Per-feature model selection (e.g. 'gpt-4o', 'claude-sonnet-4')");

const captainFeatureFlags = z
  .object({
    editor: z.boolean().optional(),
    assistant: z.boolean().optional(),
    copilot: z.boolean().optional(),
    label_suggestion: z.boolean().optional(),
    audio_transcription: z.boolean().optional(),
    help_center_search: z.boolean().optional(),
  })
  .describe("Per-feature on/off toggles");

export const register: RegisterFn = (server, client) => {
  // ── Captain preferences (account-level config) ────────────────────────────
  server.registerTool(
    "get_captain_preferences",
    {
      title: "Get Captain AI preferences",
      description:
        "Return the account's Captain AI configuration: available providers, models, and per-feature {enabled, selected_model}. Requires the `captain_ai` license feature.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/captain/preferences`);
      }),
  );

  server.registerTool(
    "update_captain_preferences",
    {
      title: "Update Captain AI preferences",
      description:
        "Patch per-feature model selection and/or feature on/off flags. Both objects are merged with existing values (partial update). Requires admin policy on the Account.",
      inputSchema: {
        account_id: optionalAccountId,
        captain_models: captainModelKeys.optional(),
        captain_features: captainFeatureFlags.optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/captain/preferences`, body);
      }),
  );

  // ── Captain tasks (synchronous AI operations) ─────────────────────────────
  server.registerTool(
    "run_captain_rewrite",
    {
      title: "Run Captain rewrite",
      description:
        "Rewrite a piece of agent content using a specified operation (e.g. 'fix_grammar', 'make_friendly', 'translate'). Returns the rewritten message synchronously.",
      inputSchema: {
        account_id: optionalAccountId,
        content: z.string().min(1).describe("Source text to be rewritten"),
        operation: z
          .string()
          .min(1)
          .describe(
            "Rewrite operation key — see Captain::RewriteService for supported values",
          ),
        conversation_display_id: conversationDisplayId.optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/captain/tasks/rewrite`,
          body,
        );
      }),
  );

  server.registerTool(
    "run_captain_summarize",
    {
      title: "Run Captain conversation summary",
      description:
        "Summarize a customer conversation. Returns the summary string synchronously.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_display_id: conversationDisplayId,
      },
    },
    async ({ account_id, conversation_display_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/captain/tasks/summarize`, {
          conversation_display_id,
        });
      }),
  );

  server.registerTool(
    "run_captain_reply_suggestion",
    {
      title: "Run Captain reply suggestion",
      description:
        "Generate a suggested next-message reply for the agent based on the conversation history. Synchronous.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_display_id: conversationDisplayId,
      },
    },
    async ({ account_id, conversation_display_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/captain/tasks/reply_suggestion`,
          { conversation_display_id },
        );
      }),
  );

  server.registerTool(
    "run_captain_label_suggestion",
    {
      title: "Run Captain label suggestion",
      description:
        "Suggest labels for a conversation based on its content. Synchronous.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_display_id: conversationDisplayId,
      },
    },
    async ({ account_id, conversation_display_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/captain/tasks/label_suggestion`,
          { conversation_display_id },
        );
      }),
  );

  server.registerTool(
    "run_captain_follow_up",
    {
      title: "Run Captain follow-up generator",
      description:
        "Generate a personalized follow-up message for a conversation. The returned object includes a `follow_up_context` token that should be passed back on subsequent calls to maintain coherent multi-turn drafting.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_display_id: conversationDisplayId,
        message: z
          .string()
          .optional()
          .describe(
            "Optional user instruction shaping the follow-up (e.g. 'shorter', 'in Spanish')",
          ),
        follow_up_context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Context token returned by a previous run_captain_follow_up call",
          ),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(
          `/api/v1/accounts/${acc}/captain/tasks/follow_up`,
          body,
        );
      }),
  );

  // The accountId import is intentionally retained for future endpoints
  // (e.g. destructive operations that should require explicit account_id).
  void accountId;
};
