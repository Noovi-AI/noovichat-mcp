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
  ACTIONS,
  CONDITIONS,
  NODE_CATEGORIES,
  TRIGGERS,
  actionTypeEnum,
  conditionTypeEnum,
  triggerEventTypeEnum,
} from "./_automation-catalog.js";
import {
  accountId,
  jsonText,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const automationId = z.number().int().positive().describe("Pipeline automation ID");
const templateId = z.number().int().positive().describe("Automation template ID");
const cardIdInput = z.number().int().positive().describe("Pipeline card ID");

/* -------------------------------------------------------------------------- */
/* Flow schema (backend column `flow`)                                        */
/*                                                                            */
/* A flow is { nodes, connections, viewport }. Nodes are typed (trigger /      */
/* condition / action / loop / split / annotation); `data` carries the         */
/* granular vocabulary (event_type for triggers, action/condition type +       */
/* params). `data` stays a permissive record so a flow read via                */
/* get_pipeline_automation round-trips cleanly through update. To build a       */
/* flow from intent, prefer the `build_automation_flow` tool.                   */
/* -------------------------------------------------------------------------- */
const flowNode = z
  .object({
    id: z.string().describe("Unique node id within the flow"),
    type: z.string().describe(`Node category: ${NODE_CATEGORIES.join(" | ")}`),
    position: z
      .object({ x: z.number(), y: z.number() })
      .passthrough()
      .optional()
      .describe("Canvas position (FlowBuilder)"),
    data: z
      .record(z.string(), z.unknown())
      .describe(
        "Node payload. trigger → { type: 'event', event_type }; " +
          "action → { type: <action>, params }; condition → { type: <condition>, params }. " +
          "Call get_automation_catalog for the full vocabulary.",
      ),
  })
  .passthrough();

const flowObject = z
  .object({
    nodes: z.array(flowNode).describe("Flow nodes — at least one trigger node"),
    connections: z
      .array(
        z
          .object({
            id: z.string(),
            source: z.string().describe("Source node id"),
            target: z.string().describe("Target node id"),
          })
          .passthrough(),
      )
      .optional()
      .describe("Directed edges between nodes"),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).passthrough().optional(),
  })
  .passthrough()
  .describe("FlowBuilder graph. Build it with build_automation_flow when possible.");

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
        "flow-based automations carry their trigger/conditions/actions inside the graph. " +
        "`flow.nodes` must be non-empty: an automation the engine cannot execute is " +
        "refused with 422, instead of being saved as a rule that shows up active and " +
        "never runs.",
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
      description:
        "Update name, description, active flag, trigger config or flow graph. Two edits " +
        "are refused with 422 because they would leave the automation active but " +
        "unexecutable: emptying `flow.nodes`, and switching `active` to true on an " +
        "automation that has no flow. Deactivating a legacy flowless automation is " +
        "always allowed.",
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
    async ({ account_id, action, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        // Backend expects `audit_action` — `action` collides with the Rails
        // routing param (the endpoint always returned [] before the v4.14
        // fix). The tool input keeps the friendly `action` name.
        const query = action ? { ...params, audit_action: action } : params;
        return client.get(`/api/v1/accounts/${acc}/pipeline/automations/all_audit_logs`, query);
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

  /* ── Cross-feature helpers ──────────────────────────────────────────────────
   * The automation engine has no metadata endpoint, so the MCP ships the
   * trigger/condition/action vocabulary statically (see _automation-catalog.ts)
   * and offers a builder so an LLM never has to assemble raw node graphs.
   * ------------------------------------------------------------------------- */

  server.registerTool(
    "get_automation_catalog",
    {
      title: "Get the pipeline-automation catalog",
      description:
        "Discover everything a pipeline automation can react to and do: every " +
        "trigger event, condition type and cross-feature action (conversation, " +
        "contact, pipeline, WhatsApp, Captain AI, Google Calendar, tasks, " +
        "webhooks) with their parameters. Call this BEFORE building a flow so " +
        "you use valid trigger/action/condition names.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      jsonText({
        node_categories: NODE_CATEGORIES,
        triggers: TRIGGERS,
        conditions: CONDITIONS,
        actions: ACTIONS,
        usage:
          "Build a flow with build_automation_flow, then pass the result as " +
          "`flow` to create_pipeline_automation (trigger_type: 'event').",
      }),
  );

  server.registerTool(
    "build_automation_flow",
    {
      title: "Build a pipeline-automation flow from intent",
      description:
        "Assemble a valid FlowBuilder graph (nodes + connections) from a simple " +
        "trigger → conditions → actions description. Returns a `flow` object " +
        "ready to pass to create_pipeline_automation. Use get_automation_catalog " +
        "first to pick valid names. This avoids hand-writing node graphs.",
      inputSchema: {
        trigger: z
          .object({
            event_type: triggerEventTypeEnum,
            config: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Optional trigger config (e.g. schedule cron, webhook filters)"),
          })
          .describe("The event that starts the flow"),
        conditions: z
          .array(
            z.object({
              type: conditionTypeEnum,
              params: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Condition params — see get_automation_catalog"),
            }),
          )
          .optional()
          .describe("Optional conditions, evaluated in order between trigger and actions"),
        actions: z
          .array(
            z.object({
              type: actionTypeEnum,
              params: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Action params — see get_automation_catalog"),
            }),
          )
          .min(1)
          .describe("One or more actions, run in order"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ trigger, conditions, actions }) => {
      const nodes: Array<Record<string, unknown>> = [];
      const connections: Array<Record<string, string>> = [];
      let x = 80;
      const step = () => {
        const pos = { x, y: 80 };
        x += 240;
        return pos;
      };

      nodes.push({
        id: "trigger-1",
        type: "trigger",
        position: step(),
        data: { type: "event", event_type: trigger.event_type, ...(trigger.config ?? {}) },
      });
      let prev = "trigger-1";

      (conditions ?? []).forEach((c, i) => {
        const id = `condition-${i + 1}`;
        nodes.push({
          id,
          type: "condition",
          position: step(),
          data: { type: c.type, params: c.params ?? {} },
        });
        connections.push({ id: `c-${connections.length + 1}`, source: prev, target: id });
        prev = id;
      });

      actions.forEach((a, i) => {
        const id = `action-${i + 1}`;
        nodes.push({
          id,
          type: "action",
          position: step(),
          data: { type: a.type, params: a.params ?? {} },
        });
        connections.push({ id: `c-${connections.length + 1}`, source: prev, target: id });
        prev = id;
      });

      return jsonText({
        flow: { nodes, connections, viewport: { x: 0, y: 0, zoom: 1 } },
        next_step: "Pass this `flow` to create_pipeline_automation with trigger_type: 'event'.",
      });
    },
  );
};
