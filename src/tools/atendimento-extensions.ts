/**
 * Atendimento Extensions — NooviChat customizations on top of native
 * Chatwoot conversations and contacts.
 *
 * NooviChat-custom feature (see NooviChat custom extensions to upstream Chatwoot conversations).
 * Includes:
 *   • bulk actions usable by agents (custom `bulk_update?` policy)
 *   • message forwards
 *   • contact merge
 *   • LGPD delete/export
 *   • contact consent records (LGPD audit trail)
 *   • per-contact appointment history
 *
 * Routes (Chatwoot/config/routes.rb):
 *   namespace :actions do                                            (line 53-55)
 *     resource :contact_merge, only: [:create]
 *   end
 *   resource :bulk_actions, only: [:create]                          (line 56)
 *   namespace :messages do                                           (line 59-61)
 *     resources :forwards, only: [:create]
 *   end
 *   resources :contacts ... do                                       (lines 277-309)
 *     member do
 *       post :lgpd_delete
 *       get  :lgpd_export
 *     end
 *     scope module: :contacts do
 *       resources :appointment_history, only: [:index]
 *       resources :consent_records, only: [:index, :create] do
 *         collection do
 *           get :summary
 *         end
 *         member do
 *           patch :grant
 *           patch :revoke
 *         end
 *       end
 *     end
 *   end
 *
 * Pipeline GDPR endpoints (restore / permanently_delete / discarded) are
 * already covered in pipeline-cards.ts and are NOT duplicated here.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
  contactId,
} from "./_helpers.js";

const conversationDisplayIdInput = z
  .number()
  .int()
  .positive()
  .describe("Conversation display ID (per-account sequence)");

const messageIdInput = z.number().int().positive().describe("Message ID");
const consentRecordId = z.number().int().positive().describe("Consent record ID");

const bulkConversationFields = z
  .object({
    status: z.enum(["open", "resolved", "pending", "snoozed"]).optional(),
    assignee_id: z.number().int().positive().nullable().optional(),
    team_id: z.number().int().positive().nullable().optional(),
    labels: z.array(z.string()).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  })
  .describe("Fields to apply to every selected conversation");

const bulkContactFields = z
  .object({
    labels: z.array(z.string()).optional(),
    additional_attributes: z.record(z.string(), z.unknown()).optional(),
    custom_attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .describe("Fields to apply to every selected contact");

export const register: RegisterFn = (server, client) => {
  // ── Bulk actions (conversations) ───────────────────────────────────────────
  server.registerTool(
    "bulk_update_conversations",
    {
      title: "Bulk update conversations",
      description:
        "Apply field updates (status, assignee, team, labels, priority) to a list of conversations. Agent-callable thanks to NooviChat's custom `bulk_update?` policy override.",
      inputSchema: {
        account_id: optionalAccountId,
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Conversation display IDs to update"),
        fields: bulkConversationFields,
      },
    },
    async ({ account_id, ids, fields }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/bulk_actions`, {
          type: "Conversation",
          ids,
          fields,
        });
      }),
  );

  // ── Bulk actions (contacts) ────────────────────────────────────────────────
  server.registerTool(
    "bulk_update_contacts",
    {
      title: "Bulk update contacts",
      description:
        "Apply field updates (labels, additional/custom attributes) to a list of contacts. Agent-callable thanks to NooviChat's `ContactPolicy#bulk_update?` override.",
      inputSchema: {
        account_id: optionalAccountId,
        ids: z.array(z.number().int().positive()).min(1).describe("Contact IDs to update"),
        fields: bulkContactFields,
      },
    },
    async ({ account_id, ids, fields }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/bulk_actions`, {
          type: "Contact",
          ids,
          fields,
        });
      }),
  );

  // ── Forward message ────────────────────────────────────────────────────────
  server.registerTool(
    "forward_message",
    {
      title: "Forward message to a conversation",
      description:
        "Forward an existing message into a target conversation. The body is replicated; attachments are copied.",
      inputSchema: {
        account_id: optionalAccountId,
        message_id: messageIdInput.describe("Source message ID"),
        conversation_id: conversationDisplayIdInput.describe("Target conversation display ID"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/messages/forwards`, body);
      }),
  );

  // ── Contact merge ──────────────────────────────────────────────────────────
  server.registerTool(
    "merge_contacts",
    {
      title: "Merge contacts",
      description:
        "Merge `mergee_contact_id` into `base_contact_id`: conversations and pipeline cards are reassigned to the base contact; the mergee is soft-deleted.",
      inputSchema: {
        account_id: accountId,
        base_contact_id: contactId.describe("Surviving contact ID (target)"),
        mergee_contact_id: contactId.describe("Contact to merge from (will be removed)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/actions/contact_merge`, body);
      }),
  );

  // ── LGPD ───────────────────────────────────────────────────────────────────
  server.registerTool(
    "lgpd_delete_contact",
    {
      title: "LGPD delete contact",
      description:
        "Trigger an LGPD-compliant deletion of a contact (anonymizes PII, removes attachments, preserves audit log). IRREVERSIBLE for the deleted PII.",
      inputSchema: { account_id: accountId, contact_id: contactId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, contact_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/contacts/${contact_id}/lgpd_delete`);
      }),
  );

  server.registerTool(
    "lgpd_export_contact",
    {
      title: "LGPD export contact data",
      description:
        "Generate an LGPD-compliant data export (right of access). Returns the export job/URL or inline payload depending on volume.",
      inputSchema: { account_id: optionalAccountId, contact_id: contactId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, contact_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/contacts/${contact_id}/lgpd_export`);
      }),
  );

  // ── Consent records ────────────────────────────────────────────────────────
  server.registerTool(
    "list_contact_consent_records",
    {
      title: "List consent records for a contact",
      description: "List consent records (granted/revoked entries by type) for a contact.",
      inputSchema: { account_id: optionalAccountId, contact_id: contactId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, contact_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/contacts/${contact_id}/consent_records`);
      }),
  );

  server.registerTool(
    "create_contact_consent_record",
    {
      title: "Create consent record",
      description:
        "Record a new consent entry (granted or initial) for a contact. Use grant_contact_consent / revoke_contact_consent to flip an existing record.",
      inputSchema: {
        account_id: optionalAccountId,
        contact_id: contactId,
        consent_type: z
          .string()
          .min(1)
          .describe("Consent type/scope (e.g., 'marketing_email', 'whatsapp_promo')"),
        granted: z.boolean().describe("Whether the consent is granted at creation time"),
        source: z.string().optional().describe("How the consent was collected (form, agent, import, etc.)"),
        notes: z.string().optional(),
      },
    },
    async ({ account_id, contact_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/contacts/${contact_id}/consent_records`, body);
      }),
  );

  server.registerTool(
    "grant_contact_consent",
    {
      title: "Grant contact consent",
      description: "Flip an existing consent record to granted=true (PATCH /consent_records/:id/grant).",
      inputSchema: {
        account_id: optionalAccountId,
        contact_id: contactId,
        consent_record_id: consentRecordId,
        notes: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, contact_id, consent_record_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/contacts/${contact_id}/consent_records/${consent_record_id}/grant`,
          body,
        );
      }),
  );

  server.registerTool(
    "revoke_contact_consent",
    {
      title: "Revoke contact consent",
      description: "Flip an existing consent record to granted=false (PATCH /consent_records/:id/revoke).",
      inputSchema: {
        account_id: optionalAccountId,
        contact_id: contactId,
        consent_record_id: consentRecordId,
        notes: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, contact_id, consent_record_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/contacts/${contact_id}/consent_records/${consent_record_id}/revoke`,
          body,
        );
      }),
  );

  server.registerTool(
    "get_consent_records_summary",
    {
      title: "Get consent records summary",
      description: "Aggregate summary of consent records for a contact (per-type latest state, audit counts).",
      inputSchema: { account_id: optionalAccountId, contact_id: contactId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, contact_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/contacts/${contact_id}/consent_records/summary`);
      }),
  );

  // ── Appointment history ────────────────────────────────────────────────────
  server.registerTool(
    "get_contact_appointment_history",
    {
      title: "Get contact appointment history",
      description:
        "List the appointment history (past + scheduled) for a single contact, useful for context-aware service interactions.",
      inputSchema: { account_id: optionalAccountId, contact_id: contactId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, contact_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/contacts/${contact_id}/appointment_history`);
      }),
  );
};
