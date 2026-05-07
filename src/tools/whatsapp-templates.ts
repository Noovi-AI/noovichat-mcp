/**
 * WhatsApp Templates — NooviChat custom CRUD over Meta Cloud API.
 *
 * Manage Meta Cloud-API WhatsApp templates from NooviChat: list, create
 * (uploads to Meta), edit, delete, and sync from Meta.
 *
 * Routes (Chatwoot/config/routes.rb 149-153):
 *   /api/v1/accounts/:account_id/whatsapp_templates
 *     - GET    /            (index)
 *     - GET    /:id         (show)
 *     - POST   /            (create — uploads to Meta)
 *     - PATCH  /:id         (update)
 *     - DELETE /:id         (destroy)
 *     - POST   /sync        (collection — refetch from Meta)
 *
 * IMPORTANT: every endpoint requires an `inbox_id` query/body param to
 * resolve the underlying WhatsApp Cloud channel (`set_inbox` before_action).
 *
 * Out of scope:
 *   - send_whatsapp_template_message: there is no dedicated route. The
 *     standard message-create endpoint accepts a `template` payload; this
 *     module does not expose a separate tool for it.
 *   - get_template_audit_log: there is no dedicated REST route exposing
 *     `whatsapp_template_audit_logs`. Auditing happens server-side; the
 *     model is internal-only.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
  pagination,
  inboxId,
} from "./_helpers.js";

const templateId = z
  .string()
  .min(1)
  .describe("WhatsApp template ID (Meta-side identifier returned by Meta)");

const templateLanguage = z
  .string()
  .min(2)
  .describe("Template language code (e.g. pt_BR, en_US)");

const templateCategory = z
  .enum(["MARKETING", "UTILITY", "AUTHENTICATION"])
  .describe("Meta template category");

const templateStatus = z
  .enum(["APPROVED", "PENDING", "REJECTED", "DISABLED", "PAUSED"])
  .describe("Meta approval status");

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "list_whatsapp_templates",
    {
      title: "List WhatsApp templates",
      description:
        "List Meta WhatsApp templates linked to a WhatsApp Cloud inbox. Filter by language, status, or category.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId.describe("WhatsApp Cloud inbox to query templates for"),
        language: templateLanguage.optional(),
        status: templateStatus.optional(),
        category: templateCategory.optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/whatsapp_templates`, params);
      }),
  );

  server.registerTool(
    "get_whatsapp_template",
    {
      title: "Get WhatsApp template",
      description: "Read the full detail of a Meta WhatsApp template.",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        template_id: templateId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, inbox_id, template_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/whatsapp_templates/${template_id}`, {
          inbox_id,
        });
      }),
  );

  server.registerTool(
    "create_whatsapp_template",
    {
      title: "Create WhatsApp template (uploads to Meta)",
      description:
        "Submit a new template to Meta for approval. Components_json must follow Meta's template schema (header/body/footer/buttons).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        name: z.string().min(1).describe("Template name (lowercase, snake_case)"),
        language: templateLanguage,
        category: templateCategory,
        components: z
          .array(z.record(z.string(), z.unknown()))
          .describe("Meta components array (header/body/footer/buttons)"),
        allow_category_change: z.boolean().optional(),
      },
    },
    async ({ account_id, inbox_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/whatsapp_templates`, {
          inbox_id,
          template: body,
        });
      }),
  );

  server.registerTool(
    "update_whatsapp_template",
    {
      title: "Update WhatsApp template",
      description:
        "Update an existing template (limited by Meta — typically only components/category changes are allowed).",
      inputSchema: {
        account_id: optionalAccountId,
        inbox_id: inboxId,
        template_id: templateId,
        category: templateCategory.optional(),
        components: z.array(z.record(z.string(), z.unknown())).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, inbox_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/whatsapp_templates/${template_id}`, {
          inbox_id,
          template: body,
        });
      }),
  );

  server.registerTool(
    "delete_whatsapp_template",
    {
      title: "Delete WhatsApp template",
      description:
        "Delete a WhatsApp template by name. Pass `template_name` (Meta requires the name, not the ID).",
      inputSchema: {
        account_id: accountId,
        inbox_id: inboxId,
        template_name: z.string().min(1).describe("Template name as registered with Meta"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, inbox_id, template_name }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        // Controller routes by params[:id] but expects template_name in the body
        // when destroy is called. We use template_name as both for safety.
        return client.delete(
          `/api/v1/accounts/${acc}/whatsapp_templates/${encodeURIComponent(template_name)}`,
          { inbox_id, template_name },
        );
      }),
  );

  server.registerTool(
    "sync_whatsapp_templates_from_meta",
    {
      title: "Sync WhatsApp templates from Meta",
      description:
        "Trigger a background job that re-fetches the latest templates and statuses from Meta for the given inbox.",
      inputSchema: { account_id: optionalAccountId, inbox_id: inboxId },
    },
    async ({ account_id, inbox_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/whatsapp_templates/sync`, { inbox_id });
      }),
  );
};
