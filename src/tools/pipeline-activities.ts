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
  agentUserId,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const activityId = z.number().int().positive().describe("Pipeline activity ID");
const sequenceId = z.number().int().positive().describe("Activity sequence ID");
const templateId = z.number().int().positive().describe("Activity template ID");
const cardIdInput = z.number().int().positive().describe("Pipeline card ID");

const sequenceTriggerType = z
  .enum(["manual", "stage_change", "time_based", "condition_based"])
  .describe("Sequence trigger type");

const sequenceStageReference = z.union([z.string().min(1), z.number().int().positive()]);
const sequenceEligibilityFilter = z
  .object({
    stage_id: sequenceStageReference.optional(),
    days_in_stage: z.number().int().min(0).max(36_500).optional(),
  })
  .strict();
const sequenceTriggerConditions = z
  .union([
    z.object({}).strict().describe("manual: empty object"),
    z
      .object({
        funnel_id: z.number().int().positive().optional(),
        from_stage_id: sequenceStageReference.optional(),
        to_stage_id: sequenceStageReference,
      })
      .strict()
      .describe("stage_change: destination stage plus optional origin and account pipeline"),
    z
      .union([
        z
          .object({
            cron_expression: z.string().min(1).max(255),
            eligibility_filter: sequenceEligibilityFilter.optional(),
          })
          .strict(),
        z
          .object({
            every_n_days: z.number().int().min(1).max(365),
            eligibility_filter: sequenceEligibilityFilter.optional(),
          })
          .strict(),
      ])
      .describe(
        "time_based: exactly one cadence. cron_expression uses five numeric fields " +
          "(minute 0-59, hour 0-23, day 1-31, month 1-12, weekday 0-7); " +
          "the API accepts *, */n, comma lists and ascending ranges.",
      ),
    z
      .object({
        field: z.enum([
          "lead_score",
          "qualification_score",
          "pipeline_stage",
          "expected_revenue",
          "priority",
        ]),
        operator: z.enum(["==", "!=", ">", "<", ">=", "<=", "contains", "not_contains"]),
        value: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.array(z.unknown()),
          z.record(z.string(), z.unknown()),
        ]),
        conjunction: z.enum(["and", "or"]).optional(),
      })
      .strict()
      .describe("condition_based: supported card field, comparison operator and non-null value"),
  ])
  .describe("Conditions matching trigger_type; invalid combinations return HTTP 422");

// Backend enum: PipelineActivity::ACTIVITY_TYPES
const activityType = z
  .enum(["call", "email", "meeting", "task", "note", "demo", "follow_up"])
  .describe("Activity type (PipelineActivity::ACTIVITY_TYPES)");

const activityStatus = z
  .enum(["pending", "in_progress", "completed", "cancelled", "overdue"])
  .describe("Activity status");

export const register: RegisterFn = (server, client) => {
  // ── List & detail ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_pipeline_activities",
    {
      title: "List pipeline activities",
      description: "List activities filtered by card, status, owner or scheduled date range.",
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
      // Activities are card-scoped: the backend resolves the card from
      // `card_id` before finding the activity, so it is required.
      inputSchema: { account_id: optionalAccountId, activity_id: activityId, card_id: cardIdInput },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, activity_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/activities/${activity_id}`, {
          card_id,
        });
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
        // Backend column is `activity_type` (PipelineActivity::ACTIVITY_TYPES).
        activity_type: activityType,
        status: z.string().optional().describe("Activity status (e.g. pending, done)"),
        priority: z.string().optional().describe("low | medium | high"),
        scheduled_at: z.string().describe("ISO8601 scheduled datetime"),
        due_at: z.string().optional().describe("ISO8601 due datetime"),
        duration: z.number().int().positive().optional().describe("Duration in minutes"),
        assigned_to_id: agentUserId.optional().describe("Agent the activity is assigned to"),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, card_id, ...activity }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller reads `card_id` directly and the rest via
        // `params.require(:activity)`.
        return client.post(`/api/v1/accounts/${acc}/pipeline/activities`, { card_id, activity });
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
        card_id: cardIdInput,
        title: z.string().optional(),
        description: z.string().optional(),
        activity_type: activityType.optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        scheduled_at: z.string().optional(),
        due_at: z.string().optional(),
        duration: z.number().int().positive().optional().describe("Duration in minutes"),
        assigned_to_id: agentUserId.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, activity_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/activities/${activity_id}`, {
          card_id,
          activity: body,
        });
      }),
  );

  server.registerTool(
    "delete_pipeline_activity",
    {
      title: "Delete pipeline activity",
      description: "Delete an activity. Use cancel_activity to keep history with cancelled status.",
      inputSchema: { account_id: accountId, activity_id: activityId, card_id: cardIdInput },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, activity_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/activities/${activity_id}`, {
          card_id,
        });
      }),
  );

  // ── Status transitions ─────────────────────────────────────────────────────
  // All member actions are card-scoped — `card_id` is required so the backend
  // can resolve the parent card before finding the activity.
  server.registerTool(
    "start_activity",
    {
      title: "Start activity",
      description: "Mark an activity as in_progress.",
      inputSchema: { account_id: optionalAccountId, activity_id: activityId, card_id: cardIdInput },
    },
    async ({ account_id, activity_id, card_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/activities/${activity_id}/start`, {
          card_id,
        });
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
        card_id: cardIdInput,
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
        card_id: cardIdInput,
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
        card_id: cardIdInput,
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
        return client.post(`/api/v1/accounts/${acc}/pipeline/activities/bulk_create`, body);
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
        trigger_type: sequenceTriggerType.optional(),
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
        return client.get(`/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}`);
      }),
  );

  server.registerTool(
    "create_activity_sequence",
    {
      title: "Create activity sequence",
      description:
        "Create a reusable sequence definition. A webhook step can only be created by an " +
        "account administrator.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        trigger_type: sequenceTriggerType.optional(),
        trigger_conditions: sequenceTriggerConditions.optional(),
        active: z.boolean().optional(),
        steps: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe(
            "Ordered step definitions. Each step: { step_number, activity_type, " +
              "title, description?, delay_days?, delay_hours?, duration?, assign_to? }.",
          ),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:pipeline_activity_sequence)`.
        return client.post(`/api/v1/accounts/${acc}/pipeline/activity_sequences`, {
          pipeline_activity_sequence: body,
        });
      }),
  );

  server.registerTool(
    "update_activity_sequence",
    {
      title: "Update activity sequence",
      description:
        "Update sequence metadata, trigger, steps or active state. Replacing steps is rejected " +
        "while executions are active. Any update to a definition that contains a webhook step, " +
        "or that adds one, requires an account administrator.",
      inputSchema: {
        account_id: optionalAccountId,
        sequence_id: sequenceId,
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        trigger_type: sequenceTriggerType.optional(),
        trigger_conditions: sequenceTriggerConditions.optional(),
        active: z.boolean().optional(),
        steps: z.array(z.record(z.string(), z.unknown())).min(1).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, sequence_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}`, {
          pipeline_activity_sequence: body,
        });
      }),
  );

  server.registerTool(
    "delete_activity_sequence",
    {
      title: "Delete activity sequence",
      description:
        "Delete an activity sequence. Existing activities created from it are preserved.",
      inputSchema: { account_id: accountId, sequence_id: sequenceId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, sequence_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/activity_sequences/${sequence_id}`);
      }),
  );

  server.registerTool(
    "activate_activity_sequence",
    {
      title: "Activate activity sequence",
      description:
        "Mark a sequence as active so it can receive executions. Definitions containing a " +
        "webhook step require an account administrator.",
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
      description:
        "Mark a sequence as inactive and pause its active executions. Definitions containing a " +
        "webhook step require an account administrator.",
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
        return client.get(`/api/v1/accounts/${acc}/pipeline/activity_templates/${template_id}`);
      }),
  );

  server.registerTool(
    "create_activity_template",
    {
      title: "Create activity template",
      description: "Create a new activity template (blueprint for activities).",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        activity_type: activityType,
        description: z.string().optional(),
        category: z.string().optional().describe("Free-form grouping category"),
        default_content: z
          .string()
          .optional()
          .describe("Default activity body/content (supports variables)"),
        default_duration: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Default duration in minutes"),
        active: z.boolean().optional(),
        default_metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:pipeline_activity_template)`.
        return client.post(`/api/v1/accounts/${acc}/pipeline/activity_templates`, {
          pipeline_activity_template: body,
        });
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
        activity_type: activityType.optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        default_content: z.string().optional(),
        default_duration: z.number().int().positive().optional(),
        active: z.boolean().optional(),
        default_metadata: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/activity_templates/${template_id}`, {
          pipeline_activity_template: body,
        });
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
        return client.delete(`/api/v1/accounts/${acc}/pipeline/activity_templates/${template_id}`);
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
