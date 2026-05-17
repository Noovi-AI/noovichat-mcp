/**
 * Pipeline Pro — automations (event-triggered flow engine) and templates.
 *
 * Routes (Chatwoot/config/routes.rb 592-621):
 *   /api/v1/accounts/:account_id/pipeline/automations
 *     member:
 *       GET    executions
 *       POST   execute
 *       POST   duplicate
 *       GET    export
 *       GET    stats
 *       GET    rate_limit
 *       GET    audit_logs
 *       POST   validate
 *       POST   dry_run
 *     collection:
 *       GET    all_executions
 *       GET    all_audit_logs
 *       GET    rate_limits
 *       POST   import
 *       POST   validate_flow
 *       GET    dashboard
 *
 *   /api/v1/accounts/:account_id/pipeline/automation_templates
 *     member: POST use
 *     collection: GET categories
 *
 * Automations are flow-style (trigger → conditions → actions). Use
 * `dry_run_automation` before `execute_automation` to preview side-effects.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const automationId = z.number().int().positive().describe("Pipeline automation ID");
const templateId = z.number().int().positive().describe("Automation template ID");
const cardIdInput = z.number().int().positive().describe("Pipeline card ID");

// Backend column is `flow` (a JSON object with `nodes`/`edges`). When `flow`
// has nodes the automation is "flow-based" and the backend skips the
// trigger/actions presence validation. Was wrongly named `flow_definition`.
const flowObject = z
  .record(z.string(), z.unknown())
  .describe(
    "Flow object — must contain a `nodes` array (and usually `edges`). " +
      "Shape mirrors the FlowBuilder UI; e.g. { nodes: [...], edges: [...] }.",
  );

// Backend enum: PipelineAutomation::TRIGGER_TYPES
const automationTriggerType = z
  .enum(["event", "webhook", "scheduled", "manual"])
  .describe("How the automation is triggered (PipelineAutomation::TRIGGER_TYPES)");

export const register: RegisterFn = (server, client) => {
  // ── List & detail ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_pipeline_automations",
    {
      title: "List pipeline automations",
      description:
        "List automations for the account. Filter by pipeline_id, enabled status, or trigger type.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
        trigger_type: z.string().optional().describe("e.g., card_created, stage_changed"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_automation",
    {
      title: "Get pipeline automation",
      description:
        "Read full automation detail including flow definition, conditions, actions, enabled state, last execution.",
      inputSchema: { account_id: optionalAccountId, automation_id: automationId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations/${automation_id}`);
      }),
  );

  // ── Create / update / delete ───────────────────────────────────────────────
  server.registerTool(
    "create_pipeline_automation",
    {
      title: "Create pipeline automation",
      description:
        "Create an automation. Provide `flow` (a FlowBuilder graph with nodes) — " +
        "flow-based automations carry their trigger/conditions/actions inside the graph.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        description: z.string().optional(),
        pipeline_id: z.number().int().positive().optional(),
        // Backend column is `active` (not `enabled`).
        active: z.boolean().optional().describe("Whether the automation is active (default true)"),
        trigger_type: automationTriggerType.optional(),
        trigger: z.record(z.string(), z.unknown()).optional().describe("Trigger config object"),
        conditions: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Condition list evaluated before the actions run"),
        schedule_config: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Schedule config when trigger_type='scheduled'"),
        flow: flowObject,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Controller does `params.require(:pipeline_automation)`. Rails implicit
        // wrapping infers the wrong key (`automation`) from the controller name,
        // so wrap explicitly to avoid a 422 "param is missing".
        return client.post(`/api/v1/accounts/${acc}/pipeline/automations`, {
          pipeline_automation: body,
        });
      }),
  );

  server.registerTool(
    "update_pipeline_automation",
    {
      title: "Update pipeline automation",
      description: "Update name, description, active flag, trigger config or flow graph.",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        pipeline_id: z.number().int().positive().optional(),
        active: z.boolean().optional(),
        trigger_type: automationTriggerType.optional(),
        trigger: z.record(z.string(), z.unknown()).optional(),
        conditions: z.array(z.record(z.string(), z.unknown())).optional(),
        schedule_config: z.record(z.string(), z.unknown()).optional(),
        flow: flowObject.optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, automation_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/automations/${automation_id}`, {
          pipeline_automation: body,
        });
      }),
  );

  server.registerTool(
    "delete_pipeline_automation",
    {
      title: "Delete pipeline automation",
      description:
        "Delete an automation. Past executions and audit logs are retained for traceability.",
      inputSchema: { account_id: accountId, automation_id: automationId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, automation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/automations/${automation_id}`);
      }),
  );

  // ── Execution ──────────────────────────────────────────────────────────────
  server.registerTool(
    "execute_automation",
    {
      title: "Execute pipeline automation",
      description: "Run an automation immediately against a card (or with a custom payload).",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        card_id: cardIdInput.optional().describe("Target card to run against"),
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Additional context overrides for variable resolution"),
      },
    },
    async ({ account_id, automation_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/execute`,
          body,
        );
      }),
  );

  server.registerTool(
    "dry_run_automation",
    {
      title: "Dry-run pipeline automation",
      description:
        "Simulate an automation execution without performing side-effects. Returns the planned actions, resolved variables, and condition outcomes.",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        card_id: cardIdInput.optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/dry_run`,
          body,
        );
      }),
  );

  // ── Validation ─────────────────────────────────────────────────────────────
  server.registerTool(
    "validate_automation",
    {
      title: "Validate pipeline automation",
      description:
        "Validate the flow of an existing automation (cycles, missing references, malformed nodes).",
      inputSchema: { account_id: optionalAccountId, automation_id: automationId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/validate`,
        );
      }),
  );

  server.registerTool(
    "validate_automation_flow",
    {
      title: "Validate a flow definition (without persisting)",
      description:
        "Validate a flow graph before creating/updating. Useful for FlowBuilder live preview.",
      inputSchema: {
        account_id: optionalAccountId,
        flow: flowObject,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, flow }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        // Backend action reads `params[:flow]`.
        return client.post(`/api/v1/accounts/${acc}/pipeline/automations/validate_flow`, { flow });
      }),
  );

  // ── Duplication / import / export ──────────────────────────────────────────
  server.registerTool(
    "duplicate_automation",
    {
      title: "Duplicate pipeline automation",
      description: "Create a copy of an automation (disabled by default — review before enabling).",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        name: z.string().optional().describe("Override name for the duplicate"),
      },
    },
    async ({ account_id, automation_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/duplicate`,
          body,
        );
      }),
  );

  server.registerTool(
    "export_automation",
    {
      title: "Export pipeline automation",
      description:
        "Export an automation as a portable JSON payload (re-importable via import_automations).",
      inputSchema: { account_id: optionalAccountId, automation_id: automationId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/export`);
      }),
  );

  server.registerTool(
    "import_automations",
    {
      title: "Import automations",
      description: "Import one or more automations from a previously exported payload.",
      inputSchema: {
        account_id: optionalAccountId,
        payload: z
          .record(z.string(), z.unknown())
          .describe("Exported automation JSON (single object or array under `automations`)"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite existing automations with the same name"),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipeline/automations/import`, body);
      }),
  );

  // ── Executions ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_automation_executions",
    {
      title: "Get executions of one automation",
      description: "List execution history (success, failure, partial) for a specific automation.",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        status: z.enum(["pending", "running", "succeeded", "failed", "cancelled"]).optional(),
        from: z.string().optional().describe("ISO8601 datetime (from)"),
        to: z.string().optional().describe("ISO8601 datetime (to)"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/executions`,
          params,
        );
      }),
  );

  server.registerTool(
    "list_all_automation_executions",
    {
      title: "List executions across all automations",
      description: "Account-wide execution log (filterable by status, automation_id, date range).",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId.optional(),
        status: z.enum(["pending", "running", "succeeded", "failed", "cancelled"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations/all_executions`, params);
      }),
  );

  // ── Audit logs ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_automation_audit_logs",
    {
      title: "Get audit logs of one automation",
      description:
        "Audit trail for a single automation (configuration changes, manual runs, toggles).",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/audit_logs`,
          params,
        );
      }),
  );

  server.registerTool(
    "list_all_automation_audit_logs",
    {
      title: "List audit logs across all automations",
      description: "Account-wide audit trail for automations (filterable by user, action, date).",
      inputSchema: {
        account_id: optionalAccountId,
        user_id: z.number().int().positive().optional(),
        action: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations/all_audit_logs`, params);
      }),
  );

  // ── Stats / rate limiting / dashboard ──────────────────────────────────────
  server.registerTool(
    "get_automation_stats",
    {
      title: "Get automation stats",
      description:
        "Aggregated execution stats for an automation (counts, success rate, avg duration).",
      inputSchema: {
        account_id: optionalAccountId,
        automation_id: automationId,
        from: z.string().optional(),
        to: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/stats`,
          params,
        );
      }),
  );

  server.registerTool(
    "get_automation_rate_limit",
    {
      title: "Get rate-limit status of an automation",
      description: "Current rate-limit window and remaining quota for an automation.",
      inputSchema: { account_id: optionalAccountId, automation_id: automationId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, automation_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipeline/automations/${automation_id}/rate_limit`,
        );
      }),
  );

  server.registerTool(
    "list_automation_rate_limits",
    {
      title: "List rate limits across automations",
      description: "Account-wide rate-limit overview for all automations.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations/rate_limits`);
      }),
  );

  server.registerTool(
    "get_automations_dashboard",
    {
      title: "Get automations dashboard",
      description:
        "Consolidated dashboard: total automations, executions, success rate, top errors.",
      inputSchema: {
        account_id: optionalAccountId,
        from: z.string().optional(),
        to: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations/dashboard`, params);
      }),
  );

  // ── Templates ──────────────────────────────────────────────────────────────
  server.registerTool(
    "list_automation_templates",
    {
      title: "List automation templates",
      description: "Catalog of pre-built automation templates available to the account.",
      inputSchema: {
        account_id: optionalAccountId,
        category: z.string().optional(),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automation_templates`, params);
      }),
  );

  server.registerTool(
    "get_automation_template",
    {
      title: "Get automation template",
      description: "Full detail of an automation template (flow_definition + metadata).",
      inputSchema: { account_id: optionalAccountId, template_id: templateId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, template_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automation_templates/${template_id}`);
      }),
  );

  server.registerTool(
    "list_automation_template_categories",
    {
      title: "List automation template categories",
      description: "Available template categories (e.g., onboarding, follow-up, qualification).",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/automation_templates/categories`);
      }),
  );

  server.registerTool(
    "use_automation_template",
    {
      title: "Use automation template",
      description:
        "Instantiate an automation from a template. Returns the newly created automation.",
      inputSchema: {
        account_id: optionalAccountId,
        template_id: templateId,
        name: z.string().optional().describe("Override name for the new automation"),
        pipeline_id: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
      },
    },
    async ({ account_id, template_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/automation_templates/${template_id}/use`,
          body,
        );
      }),
  );
};
