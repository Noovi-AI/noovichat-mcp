/**
 * Follow-Ups (formerly "Scheduled Messages") — schedule personalized messages
 * to be sent later in conversations or pipeline cards.
 *
 * Routes (Chatwoot/config/routes.rb):
 *   /api/v1/accounts/:account_id/follow-ups (account-level index, line 251)
 *
 *   /api/v1/accounts/:account_id/conversations/:conversation_id/follow-ups
 *     (lines 211-219, full CRUD + member: cancel, retry_send + collection: count)
 *
 *   /api/v1/accounts/:account_id/follow-up-templates (lines 252-265)
 *     member: POST preview, DELETE attachments/:attachment_id
 *     collection: GET variables
 *     nested: items (POST :reorder collection)
 *
 *   /api/v1/accounts/:account_id/follow-up-automations (line 266)
 *
 *   /api/v2/accounts/:account_id/reports/follow-ups (lines 832-839)
 *     collection: GET summary, GET by_user, GET by_template, GET export
 *
 * `ScheduledMessage` is a backward-compat alias of `FollowUp` — same routes.
 *
 * Backend change 2026-05-30 (Chatwoot audit MT-02): the conversation-scoped
 * index and count now apply policy_scope. A non-admin agent token therefore only
 * sees/counts ITS OWN follow-ups on a conversation; an administrator token sees
 * all. The account-level index (list_followups) was already scoped this way.
 * Response shapes are unchanged — no breaking contract change, so no version bump.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  conversationDisplayId,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const followUpId = z.number().int().positive().describe("Follow-up ID");
const templateId = z.number().int().positive().describe("Follow-up template ID");
const templateItemId = z.number().int().positive().describe("Follow-up template item ID");
const automationId = z.number().int().positive().describe("Follow-up automation ID");

const followUpStatus = z
  .enum(["pending", "scheduled", "sending", "sent", "failed", "cancelled"])
  .describe("Follow-up delivery status");

export const register: RegisterFn = (server, client) => {
  // ── Follow-ups (account-level read + nested CRUD under conversation) ───────
  server.registerTool(
    "list_followups",
    {
      title: "List follow-ups",
      description:
        "Account-level list of follow-ups. Filter by status, conversation_id, scheduled date range, or template.",
      inputSchema: {
        account_id: optionalAccountId,
        status: followUpStatus.optional(),
        conversation_id: conversationDisplayId.optional(),
        pipeline_card_id: z.number().int().positive().optional(),
        template_id: templateId.optional(),
        scheduled_from: z.string().optional().describe("ISO8601 from"),
        scheduled_to: z.string().optional().describe("ISO8601 to"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-ups`, params);
      }),
  );

  // NooviChat fase-11: global search over follow-ups (title + content).
  server.registerTool(
    "search_followups",
    {
      title: "Search follow-ups",
      description:
        "Full-text search over follow-ups across the account (matches title and content). Scoped to the caller: admins see all, agents see their own.",
      inputSchema: {
        account_id: optionalAccountId,
        q: z.string().min(1).describe("Search query (matches follow-up title/content)"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/search/follow_ups`, params);
      }),
  );

  server.registerTool(
    "get_followup",
    {
      title: "Get follow-up",
      description:
        "Read a follow-up's full detail (rendered content, attachments, scheduled_at, last attempt).",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        followup_id: followUpId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, conversation_id, followup_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/${followup_id}`,
        );
      }),
  );

  server.registerTool(
    "create_followup",
    {
      title: "Create follow-up (schedule a message)",
      description:
        "Schedule a personalized message to be sent later. Must be created under a conversation; pipeline_card_id may be linked through context.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        scheduled_at: z.string().describe("ISO8601 scheduled datetime"),
        content: z
          .string()
          .optional()
          .describe("Raw message content (required unless template_id is provided)"),
        template_id: templateId.optional().describe("Use a template instead of raw content"),
        template_variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Variables to render the template (overrides automatic resolution)"),
        pipeline_card_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optionally link the follow-up to a pipeline card"),
        attachment_ids: z
          .array(z.number().int().positive())
          .optional()
          .describe("Direct-upload IDs to attach"),
      },
    },
    async ({ account_id, conversation_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups`,
          body,
        );
      }),
  );

  server.registerTool(
    "update_followup",
    {
      title: "Update follow-up",
      description: "Update scheduled_at, content, or template variables on a pending follow-up.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        followup_id: followUpId,
        scheduled_at: z.string().optional(),
        content: z.string().optional(),
        template_variables: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, conversation_id, followup_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/${followup_id}`,
          body,
        );
      }),
  );

  server.registerTool(
    "cancel_followup",
    {
      title: "Cancel follow-up",
      description: "Cancel a pending or scheduled follow-up. Status becomes `cancelled`.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        followup_id: followUpId,
      },
    },
    async ({ account_id, conversation_id, followup_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/${followup_id}/cancel`,
        );
      }),
  );

  server.registerTool(
    "retry_send_followup",
    {
      title: "Retry sending a failed follow-up",
      description: "Re-attempt delivery of a follow-up that previously failed.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        followup_id: followUpId,
      },
    },
    async ({ account_id, conversation_id, followup_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/${followup_id}/retry_send`,
        );
      }),
  );

  server.registerTool(
    "count_conversation_followups",
    {
      title: "Count follow-ups in a conversation",
      description:
        "Lightweight count of follow-ups for a conversation (for badges). Scoped to the API token user unless they are an account admin (Chatwoot MT-02, 2026-05-30).",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        status: followUpStatus.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, conversation_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/count`,
          params,
        );
      }),
  );

  // ── Templates ──────────────────────────────────────────────────────────────
  server.registerTool(
    "list_followup_templates",
    {
      title: "List follow-up templates",
      description: "List reusable follow-up templates for the account.",
      inputSchema: {
        account_id: optionalAccountId,
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-templates`, params);
      }),
  );

  server.registerTool(
    "get_followup_template",
    {
      title: "Get follow-up template",
      description: "Full detail of a follow-up template (content, items, attachments).",
      inputSchema: { account_id: optionalAccountId, template_id: templateId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, template_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-templates/${template_id}`);
      }),
  );

  server.registerTool(
    "create_followup_template",
    {
      title: "Create follow-up template",
      description:
        "Create a reusable follow-up template with optional placeholder variables (e.g., {{contact.name}}).",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        content: z.string().min(1).describe("Template body — supports liquid-style variables"),
        description: z.string().optional(),
        category: z.string().optional(),
        attachment_ids: z.array(z.number().int().positive()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/follow-up-templates`, body);
      }),
  );

  server.registerTool(
    "update_followup_template",
    {
      title: "Update follow-up template",
      description: "Update template name, content, description or category.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        name: z.string().optional(),
        content: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/follow-up-templates/${template_id}`, body);
      }),
  );

  server.registerTool(
    "delete_followup_template",
    {
      title: "Delete follow-up template",
      description: "Delete a follow-up template.",
      inputSchema: { account_id: accountId, template_id: templateId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, template_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/follow-up-templates/${template_id}`);
      }),
  );

  server.registerTool(
    "preview_followup_template",
    {
      title: "Preview follow-up template",
      description: "Render a template against sample variables to preview the final message.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Variables to substitute during render"),
        contact_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Render against a real contact (auto-fills variables)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/follow-up-templates/${template_id}/preview`,
          body,
        );
      }),
  );

  server.registerTool(
    "list_followup_template_variables",
    {
      title: "List available follow-up template variables",
      description:
        "List the variables (placeholders) the template renderer supports — e.g., contact, account, agent, conversation fields.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-templates/variables`);
      }),
  );

  // ── Template items (steps) ─────────────────────────────────────────────────
  server.registerTool(
    "list_followup_template_items",
    {
      title: "List template items (steps)",
      description: "List ordered items (steps) of a follow-up template.",
      inputSchema: { account_id: optionalAccountId, template_id: templateId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, template_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-templates/${template_id}/items`);
      }),
  );

  server.registerTool(
    "create_followup_template_item",
    {
      title: "Create template item",
      description: "Add an ordered step to a follow-up template.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        // Required by the backend (FollowUpTemplateItem::ITEM_TYPES).
        item_type: z
          .enum(["text", "image", "audio", "video", "document", "whatsapp_template"])
          .describe(
            "Step type — `text` requires `content`; media types use attachments; " +
              "`whatsapp_template` sends a Meta-approved WhatsApp template (official inbox, " +
              "outside the 24h window) and falls back to `content` text otherwise",
          ),
        content: z
          .string()
          .optional()
          .describe(
            "Message body. Required for `text`. For `whatsapp_template` it is the plain-text " +
              "fallback sent on non-official providers (WAHA/UazAPI) or inside the 24h window",
          ),
        delay_seconds: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Seconds after the previous step before this one fires"),
        position: z.number().int().nonnegative().optional(),
        // whatsapp_template item — approved-template reference + parameter mapping.
        whatsapp_template_name: z
          .string()
          .optional()
          .describe("Approved Meta template name (required when item_type is 'whatsapp_template')"),
        whatsapp_template_language: z
          .string()
          .optional()
          .describe("Approved template language code, e.g. 'pt_BR'"),
        whatsapp_template_namespace: z
          .string()
          .optional()
          .describe("Template namespace (360Dialog only)"),
        whatsapp_template_mapping: z
          .object({
            body: z
              .array(
                z.object({
                  type: z.enum(["variable", "text"]),
                  value: z
                    .string()
                    .describe("Follow-up variable name (e.g. 'contact_name') or literal text"),
                }),
              )
              .describe("Ordered BODY parameters ({{1}}, {{2}}, …)"),
          })
          .optional()
          .describe(
            'Template parameter mapping, e.g. { "body": [ { "type": "variable", "value": "contact_name" } ] }',
          ),
      },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        // Controller does `params.require(:follow_up_template_item)` — wrap explicitly.
        return client.post(`/api/v1/accounts/${acc}/follow-up-templates/${template_id}/items`, {
          follow_up_template_item: body,
        });
      }),
  );

  server.registerTool(
    "delete_followup_template_item",
    {
      title: "Delete template item",
      description: "Remove a step from a follow-up template.",
      inputSchema: {
        account_id: accountId,
        template_id: templateId,
        item_id: templateItemId,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, template_id, item_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/follow-up-templates/${template_id}/items/${item_id}`,
        );
      }),
  );

  server.registerTool(
    "reorder_followup_template_items",
    {
      title: "Reorder template items",
      description: "Reorder the steps of a follow-up template.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        item_ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Item IDs in the desired order"),
      },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/follow-up-templates/${template_id}/items/reorder`,
          body,
        );
      }),
  );

  // ── Automations ────────────────────────────────────────────────────────────
  server.registerTool(
    "list_followup_automations",
    {
      title: "List follow-up automations",
      description:
        "List automations that trigger follow-ups based on conversation/pipeline events.",
      inputSchema: {
        account_id: optionalAccountId,
        enabled: z.boolean().optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-automations`, params);
      }),
  );

  server.registerTool(
    "get_followup_automation",
    {
      title: "Get follow-up automation",
      description: "Full detail of a follow-up automation.",
      inputSchema: { account_id: optionalAccountId, automation_id: automationId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-automations/${automation_id}`);
      }),
  );

  // Backend enum: FollowUpAutomation::TRIGGER_TYPES
  const followUpTriggerType = z
    .enum([
      "label_added",
      "label_removed",
      "contact_created",
      "conversation_created",
      "conversation_resolved",
      "conversation_inactivity",
    ])
    .describe("Event that fires the automation (FollowUpAutomation::TRIGGER_TYPES)");

  // Backend enum: FollowUpAutomation::CONTENT_MODES
  const followUpContentMode = z
    .enum(["template", "ai"])
    .describe(
      "Message source: 'template' renders a FollowUpTemplate; 'ai' generates the message at send time from ai_instruction + the conversation history",
    );

  server.registerTool(
    "create_followup_automation",
    {
      title: "Create follow-up automation",
      description:
        "Create an automation that schedules a follow-up when a trigger event fires. The message comes from a template (content_mode='template') or is generated by AI (content_mode='ai').",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        trigger_type: followUpTriggerType,
        content_mode: followUpContentMode.optional().describe("Defaults to 'template'"),
        // Required by the backend only in template mode; AI automations have no template.
        follow_up_template_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "ID of the FollowUpTemplate to schedule. Required when content_mode='template'",
          ),
        ai_instruction: z
          .string()
          .optional()
          .describe(
            "Goal/instruction for the AI-written follow-up. Required when content_mode='ai'",
          ),
        delay_minutes: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Minutes to wait after the trigger before scheduling (ignored for conversation_inactivity)",
          ),
        enabled: z.boolean().optional().describe("Whether the automation is active (default true)"),
        trigger_config: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Trigger-specific config: { label_id } for label_added/removed; { inactivity_minutes } for conversation_inactivity (customer silence since their last received message)",
          ),
        conditions: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Additional condition tree evaluated before scheduling"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:follow_up_automation)` — wrap explicitly.
        return client.post(`/api/v1/accounts/${acc}/follow-up-automations`, {
          follow_up_automation: body,
        });
      }),
  );

  server.registerTool(
    "update_followup_automation",
    {
      title: "Update follow-up automation",
      description:
        "Update an automation's name, trigger, template, delay, conditions or enabled flag.",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        name: z.string().optional(),
        trigger_type: followUpTriggerType.optional(),
        content_mode: followUpContentMode.optional(),
        follow_up_template_id: z.number().int().positive().optional(),
        ai_instruction: z.string().optional(),
        delay_minutes: z.number().int().nonnegative().optional(),
        enabled: z.boolean().optional(),
        trigger_config: z.record(z.string(), z.unknown()).optional(),
        conditions: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, automation_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/follow-up-automations/${automation_id}`, {
          follow_up_automation: body,
        });
      }),
  );

  server.registerTool(
    "delete_followup_automation",
    {
      title: "Delete follow-up automation",
      description: "Delete a follow-up automation.",
      inputSchema: { account_id: accountId, automation_id: automationId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, automation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/follow-up-automations/${automation_id}`);
      }),
  );

  // ── Reports (v2) ───────────────────────────────────────────────────────────
  server.registerTool(
    "get_followups_report",
    {
      title: "Get follow-ups report",
      description:
        "Aggregated follow-up reports under v2 namespace. Pass `view` to switch between summary, by_user, by_template or export.",
      inputSchema: {
        account_id: optionalAccountId,
        view: z
          .enum(["index", "summary", "by_user", "by_template", "export"])
          .default("summary")
          .describe("Which report endpoint to call"),
        from: z.string().optional().describe("ISO8601 from"),
        to: z.string().optional().describe("ISO8601 to"),
        user_id: z.number().int().positive().optional(),
        template_id: templateId.optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, view, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        const base = `/api/v2/accounts/${acc}/reports/follow-ups`;
        const path = view === "index" ? base : `${base}/${view}`;
        return client.get(path, params);
      }),
  );
};
