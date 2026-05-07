/**
 * Pipeline Pro — activities (tasks/calls/meetings), activity sequences and
 * activity templates.
 *
 * Routes (Chatwoot/config/routes.rb 625-653):
 *   /api/v1/accounts/:account_id/pipeline/activities
 *     member: POST start, POST complete, POST cancel, POST reschedule
 *     collection: GET search, GET analytics, GET templates,
 *                 POST bulk_create, POST create_from_template
 *
 *   /api/v1/accounts/:account_id/pipeline/activity_sequences
 *     member: POST activate, POST deactivate, POST duplicate
 *
 *   /api/v1/accounts/:account_id/pipeline/activity_templates
 *     member: POST duplicate
 *
 * Activities are scheduled tasks attached to cards. Sequences are reusable
 * activity bundles. Templates are blueprints for creating activities.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
  pagination,
  agentUserId,
} from "./_helpers.js";

const activityId = z.number().int().positive().describe("Pipeline activity ID");
const sequenceId = z.number().int().positive().describe("Activity sequence ID");
const templateId = z.number().int().positive().describe("Activity template ID");
const cardIdInput = z.number().int().positive().describe("Pipeline card ID");

const activityType = z
  .enum(["task", "call", "meeting", "email", "whatsapp", "note", "custom"])
  .describe("Activity type");

const activityStatus = z
  .enum(["pending", "in_progress", "completed", "cancelled", "overdue"])
  .describe("Activity status");

export const register: RegisterFn = (server, client) => {
  // ── List & detail ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_pipeline_activities",
    {
      title: "List pipeline activities",
      description:
        "List activities filtered by card, status, owner or scheduled date range.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput.optional(),
        status: activityStatus.optional(),
        owner_id: agentUserId.optional(),
        type: activityType.optional(),
        from: z.string().optional().describe("Scheduled-from ISO8601 date"),
        to: z.string().optional().describe("Scheduled-to ISO8601 date"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/activities`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_activity",
    {
      title: "Get pipeline activity",
      description: "Read full activity detail (participants, attachments, reminders).",
      inputSchema: { account_id: optionalAccountId, activity_id: activityId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, activity_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/activities/${activity_id}`);
      }),
  );

  // ── Create / update / delete ───────────────────────────────────────────────
  server.registerTool(
    "create_pipeline_activity",
    {
      title: "Create pipeline activity",
      description: "Create an activity attached to a card.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardIdInput,
        title: z.string().min(1),
        description: z.string().optional(),
        type: activityType,
        scheduled_at: z.string().describe("ISO8601 scheduled datetime"),
        duration_minutes: z.number().int().positive().optional(),
        owner_id: agentUserId.optional(),
        participant_ids: z.array(z.number().int().positive()).optional(),
        reminder_minutes_before: z.number().int().nonnegative().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline/activities`, body);
      }),
  );

  server.registerTool(
    "update_pipeline_activity",
    {
      title: "Update pipeline activity",
      description:
        "Update activity fields. Use reschedule_activity for time changes that need history tracking.",
      inputSchema: {
        account_id: optionalAccountId,
        activity_id: activityId,
        title: z.string().optional(),
        description: z.string().optional(),
        scheduled_at: z.string().optional(),
        duration_minutes: z.number().int().positive().optional(),
        owner_id: agentUserId.optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, activity_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/activities/${activity_id}`,
          body,
        );
      }),
  );

  server.registerTool(
    "delete_pipeline_activity",
    {
      title: "Delete pipeline activity",
      description: "Delete an activity. Use cancel_activity to keep history with cancelled status.",
      inputSchema: { account_id: accountId, activity_id: activityId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, activity_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/activities/${activity_id}`);
      }),
  );

  // ── Status transitions ─────────────────────────────────────────────────────
  server.registerTool(
    "start_activity",
    {
      title: "Start activity",
      description: "Mark an activity as in_progress.",
      inputSchema: { account_id: optionalAccountId, activity_id: activityId },
    },
    async ({ account_id, activity_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activities/${activity_id}/start`,
        );
      }),
  );

  server.registerTool(
    "complete_activity",
    {
      title: "Complete activity",
      description: "Mark an activity as completed. Optionally pass an outcome note.",
      inputSchema: {
        account_id: optionalAccountId,
        activity_id: activityId,
        outcome: z.string().optional().describe("Outcome / completion notes"),
      },
    },
    async ({ account_id, activity_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activities/${activity_id}/complete`,
          body,
        );
      }),
  );

  server.registerTool(
    "cancel_activity",
    {
      title: "Cancel activity",
      description: "Cancel an activity with optional reason. Preserves activity record.",
      inputSchema: {
        account_id: optionalAccountId,
        activity_id: activityId,
        reason: z.string().optional(),
      },
    },
    async ({ account_id, activity_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activities/${activity_id}/cancel`,
          body,
        );
      }),
  );

  server.registerTool(
    "reschedule_activity",
    {
      title: "Reschedule activity",
      description: "Move an activity to a new scheduled time. Tracks history.",
      inputSchema: {
        account_id: optionalAccountId,
        activity_id: activityId,
        scheduled_at: z.string().describe("New ISO8601 scheduled datetime"),
        reason: z.string().optional(),
      },
    },
    async ({ account_id, activity_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activities/${activity_id}/reschedule`,
          body,
        );
      }),
  );

  // ── Search / analytics ─────────────────────────────────────────────────────
  server.registerTool(
    "search_activities",
    {
      title: "Search activities",
      description: "Full-text search over activities (title, description, participants).",
      inputSchema: {
        account_id: optionalAccountId,
        q: z.string().min(1).describe("Search query"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/activities/search`, params);
      }),
  );

  server.registerTool(
    "get_activities_analytics",
    {
      title: "Get activities analytics",
      description: "Aggregated analytics (completion rate, on-time rate, by owner, by type).",
      inputSchema: {
        account_id: optionalAccountId,
        from: z.string().optional(),
        to: z.string().optional(),
        owner_id: agentUserId.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/activities/analytics`, params);
      }),
  );

  // ── Bulk + template-driven creation ────────────────────────────────────────
  server.registerTool(
    "bulk_create_activities",
    {
      title: "Bulk create activities",
      description: "Create multiple activities in one call (e.g., follow-up tasks for many cards).",
      inputSchema: {
        account_id: optionalAccountId,
        activities: z
          .array(
            z.object({
              card_id: cardIdInput,
              title: z.string().min(1),
              type: activityType,
              scheduled_at: z.string(),
              owner_id: agentUserId.optional(),
              description: z.string().optional(),
              duration_minutes: z.number().int().positive().optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activities/bulk_create`,
          body,
        );
      }),
  );

  server.registerTool(
    "create_activity_from_template",
    {
      title: "Create activity from template",
      description: "Instantiate an activity (or set of activities) from a template.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        card_id: cardIdInput,
        scheduled_at: z.string().optional().describe("Override scheduled date"),
        owner_id: agentUserId.optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activities/create_from_template`,
          body,
        );
      }),
  );

  // ── Activity sequences ─────────────────────────────────────────────────────
  server.registerTool(
    "list_activity_sequences",
    {
      title: "List activity sequences",
      description: "List reusable activity sequences (bundles of templated activities).",
      inputSchema: {
        account_id: optionalAccountId,
        active: z.boolean().optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/activity_sequences`, params);
      }),
  );

  server.registerTool(
    "get_activity_sequence",
    {
      title: "Get activity sequence",
      description: "Full detail of an activity sequence (steps, scheduling rules).",
      inputSchema: { account_id: optionalAccountId, sequence_id: sequenceId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}`,
        );
      }),
  );

  server.registerTool(
    "create_activity_sequence",
    {
      title: "Create activity sequence",
      description: "Create a new reusable activity sequence.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        description: z.string().optional(),
        active: z.boolean().optional(),
        steps: z
          .array(z.record(z.string(), z.unknown()))
          .describe("Ordered step definitions (template_id, offset_minutes, etc.)"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline/activity_sequences`, body);
      }),
  );

  server.registerTool(
    "update_activity_sequence",
    {
      title: "Update activity sequence",
      description: "Update sequence name, steps or active flag.",
      inputSchema: {
        account_id: optionalAccountId,
        sequence_id: sequenceId,
        name: z.string().optional(),
        description: z.string().optional(),
        active: z.boolean().optional(),
        steps: z.array(z.record(z.string(), z.unknown())).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, sequence_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}`,
          body,
        );
      }),
  );

  server.registerTool(
    "delete_activity_sequence",
    {
      title: "Delete activity sequence",
      description: "Delete an activity sequence. Existing activities created from it are preserved.",
      inputSchema: { account_id: accountId, sequence_id: sequenceId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}`,
        );
      }),
  );

  server.registerTool(
    "activate_activity_sequence",
    {
      title: "Activate activity sequence",
      description: "Mark a sequence as active so it becomes available for use.",
      inputSchema: { account_id: optionalAccountId, sequence_id: sequenceId },
    },
    async ({ account_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}/activate`,
        );
      }),
  );

  server.registerTool(
    "deactivate_activity_sequence",
    {
      title: "Deactivate activity sequence",
      description: "Mark a sequence as inactive (hidden from the picker but not deleted).",
      inputSchema: { account_id: optionalAccountId, sequence_id: sequenceId },
    },
    async ({ account_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}/deactivate`,
        );
      }),
  );

  server.registerTool(
    "duplicate_activity_sequence",
    {
      title: "Duplicate activity sequence",
      description: "Create a copy of a sequence (deactivated by default).",
      inputSchema: {
        account_id: optionalAccountId,
        sequence_id: sequenceId,
        name: z.string().optional(),
      },
    },
    async ({ account_id, sequence_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}/duplicate`,
          body,
        );
      }),
  );

  // ── Activity templates ─────────────────────────────────────────────────────
  server.registerTool(
    "list_activity_templates",
    {
      title: "List activity templates",
      description: "List reusable activity templates (single-activity blueprints).",
      inputSchema: {
        account_id: optionalAccountId,
        type: activityType.optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/activity_templates`, params);
      }),
  );

  server.registerTool(
    "get_activity_template",
    {
      title: "Get activity template",
      description: "Full detail of an activity template.",
      inputSchema: { account_id: optionalAccountId, template_id: templateId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, template_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipeline/activity_templates/${template_id}`,
        );
      }),
  );

  server.registerTool(
    "create_activity_template",
    {
      title: "Create activity template",
      description: "Create a new activity template (blueprint).",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        type: activityType,
        title_template: z
          .string()
          .describe("Title pattern (supports variables like {{contact.name}})"),
        description_template: z.string().optional(),
        default_duration_minutes: z.number().int().positive().optional(),
        default_offset_minutes: z
          .number()
          .int()
          .optional()
          .describe("Offset relative to anchor when used in a sequence"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline/activity_templates`, body);
      }),
  );

  server.registerTool(
    "update_activity_template",
    {
      title: "Update activity template",
      description: "Update an activity template.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        name: z.string().optional(),
        title_template: z.string().optional(),
        description_template: z.string().optional(),
        default_duration_minutes: z.number().int().positive().optional(),
        default_offset_minutes: z.number().int().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipeline/activity_templates/${template_id}`,
          body,
        );
      }),
  );

  server.registerTool(
    "delete_activity_template",
    {
      title: "Delete activity template",
      description: "Delete an activity template.",
      inputSchema: { account_id: accountId, template_id: templateId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, template_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/pipeline/activity_templates/${template_id}`,
        );
      }),
  );

  server.registerTool(
    "duplicate_activity_template",
    {
      title: "Duplicate activity template",
      description: "Create a copy of an activity template.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        name: z.string().optional(),
      },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/activity_templates/${template_id}/duplicate`,
          body,
        );
      }),
  );
};
