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
 *     nested: items (index/show/create/update/destroy + POST :reorder collection;
 *             PUT is accepted as an alias of PATCH on items/:id)
 *
 * Not exposed: POST /follow-ups/import (multipart `import_file` CSV upload — the
 * MCP client only sends JSON) and item/template file uploads (`attachment`,
 * `attachments` multipart fields). Attachment DELETE is JSON and is exposed.
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
 *
 * Contract audit 2026-09-27 (Chatwoot FU-35): follow-up and template writes now
 * use the `follow_up` / `follow_up_template` envelopes the controllers require;
 * fields the API never read (template_variables, pipeline_card_id,
 * attachment_ids, description, category, pagination on unpaginated lists) are
 * gone instead of being dropped server-side; reports take `since`/`until`
 * (epoch seconds), not `from`/`to`.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  conversationDisplayId,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const followUpId = z.number().int().positive().describe("Follow-up ID");
const templateId = z.number().int().positive().describe("Follow-up template ID");
const templateItemId = z.number().int().positive().describe("Follow-up template item ID");
const automationId = z.number().int().positive().describe("Follow-up automation ID");

// FollowUp status enum. `scheduled`/`sending` never existed — asking for them
// matched nothing (auditoria Chatwoot 2026-09-27, FU-35).
const followUpStatus = z
  .enum(["pending", "sent", "failed", "cancelled"])
  .describe("Follow-up delivery status");

// `scheduled_at` accepted by Conversations::FollowUpsController: ISO 8601 (a value
// without offset is wall-clock time in the account timezone) or a Unix epoch in
// seconds — the same number the API returns.
const scheduledAt = z
  .union([z.string(), z.number().int()])
  .describe(
    "When to send: ISO 8601 (no offset = account timezone) or Unix epoch in seconds. Must be in the future",
  );

// Fields of Conversations::FollowUpsController#follow_up_params. The controller
// requires the `follow_up` envelope; anything outside this list was dropped.
const followUpWritableFields = {
  title: z.string().optional(),
  inbox_id: z.number().int().positive().optional().describe("Inbox the follow-up is sent from"),
  follow_up_template_id: templateId
    .optional()
    .describe("Follow-up template to send (text or multi-step cadence)"),
  template_params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Meta-approved WhatsApp template for a WhatsApp Cloud inbox: { name, language, namespace, processed_params }",
    ),
};

// Fields of FollowUpTemplateItemsController#item_params (wrapper
// `follow_up_template_item`). Shared by create and update.
// Required on create by the backend (FollowUpTemplateItem::ITEM_TYPES).
const templateItemType = z
  .enum(["text", "image", "audio", "video", "document", "whatsapp_template"])
  .describe(
    "Step type — `text` requires `content`; media types use attachments; " +
      "`whatsapp_template` sends a Meta-approved WhatsApp template (official inbox, " +
      "outside the 24h window) and falls back to `content` text otherwise",
  );

const templateItemFields = {
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
        .optional()
        .describe("Ordered BODY parameters ({{1}}, {{2}}, …)"),
      header: z
        .object({
          media_url: z
            .string()
            .describe("Public https URL of the file — WhatsApp fetches it when sending"),
          media_type: z
            .enum(["document", "image", "video"])
            .describe(
              "Header format declared by the approved template. Required whenever " +
                "`header` is sent: without it the server answers 422, and before it " +
                "validated this the file URL was sent as a TEXT parameter for a " +
                "document header, which Meta refuses.",
            ),
          media_name: z
            .string()
            .optional()
            .describe("Filename shown to the recipient (DOCUMENT headers)"),
        })
        .optional()
        .describe(
          "Required when the approved template declares a media header: Meta rejects " +
            "the send without this parameter, it does not deliver without the file.",
        ),
    })
    .optional()
    .describe(
      'Template parameter mapping, e.g. { "body": [ { "type": "variable", "value": "contact_name" } ], ' +
        '"header": { "media_url": "https://cdn.example.com/file.pdf", "media_type": "document" } }',
    ),
};

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
        scheduled_from: z
          .string()
          .optional()
          .describe(
            "Window start (inclusive): ISO 8601 (no offset = account timezone) or epoch seconds",
          ),
        scheduled_to: z
          .string()
          .optional()
          .describe(
            "Window end (inclusive): ISO 8601 (no offset = account timezone) or epoch seconds",
          ),
        page: z.number().int().positive().optional().describe("Page (only with per_page)"),
        per_page: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Items per page (max 100). Omit to get the whole filtered list"),
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
        page: z.number().int().positive().optional().describe("Page (15 results per page)"),
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
        "Read one follow-up of a conversation: content, scheduled_at, status, owner, WhatsApp template name and, when it failed, error_message.",
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
        "Schedule a message to be sent later in a conversation. Give `content` or a `follow_up_template_id` (template variables are filled from the conversation at send time).",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        scheduled_at: scheduledAt,
        content: z
          .string()
          .optional()
          .describe("Message text (required unless follow_up_template_id is given)"),
        ...followUpWritableFields,
      },
    },
    async ({ account_id, conversation_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:follow_up)` — wrap explicitly.
        return client.post(`/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups`, {
          follow_up: body,
        });
      }),
  );

  server.registerTool(
    "update_followup",
    {
      title: "Update follow-up",
      description:
        "Edit or reschedule a pending follow-up (other statuses answer 422). Send only the fields to change. Changing `content` of a WhatsApp-template follow-up without `template_params` turns it into a plain message.",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
        followup_id: followUpId,
        scheduled_at: scheduledAt.optional(),
        content: z.string().optional(),
        ...followUpWritableFields,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, conversation_id, followup_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/${followup_id}`,
          { follow_up: body },
        );
      }),
  );

  server.registerTool(
    "cancel_followup",
    {
      title: "Cancel follow-up",
      description:
        "Cancel a pending follow-up. Status becomes `cancelled` and it stays in the history.",
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
    "delete_followup",
    {
      title: "Delete follow-up",
      description:
        "Permanently delete a pending follow-up (it leaves the history; webhooks get follow_up_cancelled). Use cancel_followup to keep the record.",
      inputSchema: {
        account_id: accountId,
        conversation_id: conversationDisplayId,
        followup_id: followUpId,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, conversation_id, followup_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/${followup_id}`,
        );
      }),
  );

  server.registerTool(
    "retry_send_followup",
    {
      title: "Retry sending a failed follow-up",
      description:
        "Re-send a failed follow-up in about a minute (a multi-step cadence resumes from the step that failed). At most 5 manual retries per follow-up.",
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
        "Lightweight count of all follow-ups of a conversation, any status (for badges). Scoped to the API token user unless they are an account admin (Chatwoot MT-02, 2026-05-30).",
      inputSchema: {
        account_id: optionalAccountId,
        conversation_id: conversationDisplayId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, conversation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/conversations/${conversation_id}/follow-ups/count`,
        );
      }),
  );

  // ── Templates ──────────────────────────────────────────────────────────────
  server.registerTool(
    "list_followup_templates",
    {
      title: "List follow-up templates",
      description: "List the account's active follow-up templates (not paginated).",
      inputSchema: {
        account_id: optionalAccountId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-templates`);
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
        "Create a reusable follow-up template. Variables use {{name}} placeholders — list them with list_followup_template_variables. File attachments need a multipart upload and are not supported here.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        content: z.string().min(1).describe("Template body with {{variable}} placeholders"),
        active: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:follow_up_template)` — wrap explicitly.
        return client.post(`/api/v1/accounts/${acc}/follow-up-templates`, {
          follow_up_template: body,
        });
      }),
  );

  server.registerTool(
    "update_followup_template",
    {
      title: "Update follow-up template",
      description: "Update a template's name, content or active flag.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        name: z.string().optional(),
        content: z.string().optional(),
        active: z.boolean().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/follow-up-templates/${template_id}`, {
          follow_up_template: body,
        });
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
    "delete_followup_template_attachment",
    {
      title: "Delete template attachment",
      description:
        "Permanently delete (purge) one file attached to a follow-up template. Attachment IDs are in get_followup_template's `attachments`. Returns the updated template; 404 when the attachment or an active template is not found.",
      inputSchema: {
        account_id: accountId,
        template_id: templateId,
        attachment_id: z.number().int().positive().describe("Template attachment ID"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, template_id, attachment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/follow-up-templates/${template_id}/attachments/${attachment_id}`,
        );
      }),
  );

  server.registerTool(
    "preview_followup_template",
    {
      title: "Preview follow-up template",
      description:
        "Render a template to preview the final message. Without `context` the preview uses sample values.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        context: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Values for the template variables, e.g. { contact_name: 'Ana' } (names from list_followup_template_variables)",
          ),
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
        item_type: templateItemType,
        ...templateItemFields,
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
    "get_followup_template_item",
    {
      title: "Get template item",
      description:
        "Read one step of a follow-up template (item_type, content, delay_seconds, position, WhatsApp template fields, attachment).",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        item_id: templateItemId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, template_id, item_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/follow-up-templates/${template_id}/items/${item_id}`,
        );
      }),
  );

  server.registerTool(
    "update_followup_template_item",
    {
      title: "Update template item",
      description:
        "Update a step of a follow-up template. Only the fields sent are changed. Returns 404 when the template is inactive.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        item_id: templateItemId,
        item_type: templateItemType.optional(),
        ...templateItemFields,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, template_id, item_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/follow-up-templates/${template_id}/items/${item_id}`,
          { follow_up_template_item: body },
        );
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
      description:
        "Reorder the steps of a follow-up template. Each item keeps its delay_seconds. Returns the reordered { payload: [...] }.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        item_ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Item IDs in the desired order"),
      },
    },
    async ({ account_id, template_id, item_ids }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        // The controller reads `items: [{ id, delay_seconds? }]` and answers 400
        // "Items order required" to anything else — sending `item_ids` never
        // reordered. Omitting delay_seconds keeps each item's current delay.
        return client.post(
          `/api/v1/accounts/${acc}/follow-up-templates/${template_id}/items/reorder`,
          { items: item_ids.map((id) => ({ id })) },
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
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/follow-up-automations`);
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
        "Aggregated follow-up reports (v2). `view`: index (everything + daily series), summary, by_user, by_template or export (JSON rows). The period filters scheduled_at and needs both `since` and `until` (max 400 days).",
      inputSchema: {
        account_id: optionalAccountId,
        view: z
          .enum(["index", "summary", "by_user", "by_template", "export"])
          .default("summary")
          .describe("Which report endpoint to call"),
        since: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Period start, Unix epoch seconds"),
        until: z.number().int().nonnegative().optional().describe("Period end, Unix epoch seconds"),
        status: followUpStatus.optional(),
        source: z.enum(["manual", "template", "pipeline", "automation"]).optional(),
        user_id: z.number().int().positive().optional().describe("Follow-up owner"),
        template_id: templateId.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, view, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        const base = `/api/v2/accounts/${acc}/reports/follow-ups`;
        // `export` answers CSV or JSON by format — ask for JSON explicitly.
        const path =
          view === "index" ? base : view === "export" ? `${base}/export.json` : `${base}/${view}`;
        return client.get(path, params);
      }),
  );
};
