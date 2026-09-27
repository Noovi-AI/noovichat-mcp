/**
 * Pipeline Pro — pipelines + stages.
 *
 * Routes (Chatwoot/config/routes.rb 531-537):
 *   GET    /api/v1/accounts/:account_id/pipelines
 *   GET    /api/v1/accounts/:account_id/pipelines/:id
 *   POST   /api/v1/accounts/:account_id/pipelines
 *   PATCH  /api/v1/accounts/:account_id/pipelines/:id
 *   DELETE /api/v1/accounts/:account_id/pipelines/:id
 *   GET    /api/v1/accounts/:account_id/pipelines/:id/stages
 *
 * Stage-transition follow-up rules (PipelineFollowUpRulesController):
 *   GET    /api/v1/accounts/:account_id/pipelines/:pipeline_id/follow-up-rules
 *   GET    /api/v1/accounts/:account_id/pipelines/:pipeline_id/follow-up-rules/:id
 *   POST   /api/v1/accounts/:account_id/pipelines/:pipeline_id/follow-up-rules
 *   PATCH  /api/v1/accounts/:account_id/pipelines/:pipeline_id/follow-up-rules/:id (PUT alias)
 *   DELETE /api/v1/accounts/:account_id/pipelines/:pipeline_id/follow-up-rules/:id
 *
 * A rule schedules a follow-up when a card enters `to_stage` (optionally only
 * when it comes from `from_stage`). Create/update bodies are wrapped in
 * `pipeline_follow_up_rule` (strong params); index returns `{ payload: [...] }`.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId as accountIdSchema,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const pipelineId = z.number().int().positive().describe("Pipeline ID");
const followUpRuleId = z.number().int().positive().describe("Pipeline follow-up rule ID");
const ruleStage = z
  .string()
  .min(1)
  .describe('Stage key of this pipeline (e.g. "3321_qualificado")');

// SendWindowConfigurable: when enabled, days is a non-empty array of weekdays
// (0=Sunday..6=Saturday) and start/end are "HH:MM" with end after start.
const sendWindow = z
  .object({
    enabled: z.boolean().optional(),
    start: z.string().optional().describe('Window start, "HH:MM" 24h'),
    end: z.string().optional().describe('Window end, "HH:MM" 24h, after start'),
    days: z
      .array(z.number().int().min(0).max(6))
      .optional()
      .describe("Allowed weekdays, 0=Sunday .. 6=Saturday"),
  })
  .describe(
    "Restricts WHEN the generated follow-up may be sent. {} or enabled:false = no restriction",
  );

const followUpRuleFields = {
  follow_up_template_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Follow-up template to send. Required on create when content_mode is 'template'"),
  from_stage: ruleStage
    .nullable()
    .optional()
    .describe("Only fire when the card comes from this stage. Omit/null = from any stage"),
  delay_minutes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Minutes after the stage change before the follow-up is sent"),
  enabled: z.boolean().optional(),
  content_mode: z
    .enum(["template", "ai"])
    .optional()
    .describe(
      "'template' sends the template; 'ai' has NooviAI write the message from ai_instruction",
    ),
  ai_instruction: z
    .string()
    .max(4096)
    .optional()
    .describe("Instruction for the AI-written message. Required when content_mode is 'ai'"),
  sender_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Agent (User) who sends it. Mutually exclusive with sender_agent_bot_id"),
  sender_agent_bot_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Agent bot that sends it. Mutually exclusive with sender_id"),
  conditions: z.record(z.string(), z.unknown()).optional().describe("Free-form conditions object"),
  send_window: sendWindow.optional(),
};

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "list_pipelines",
    {
      title: "List pipelines",
      description: "Retrieve all pipelines (Kanban funnels) for the account.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipelines`);
      }),
  );

  server.registerTool(
    "get_pipeline",
    {
      title: "Get pipeline",
      description: "Get a specific pipeline (funnel) by ID, including stages and configuration.",
      inputSchema: { account_id: optionalAccountId, pipeline_id: pipelineId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, pipeline_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`);
      }),
  );

  server.registerTool(
    "get_pipeline_stages",
    {
      title: "Get pipeline stages",
      description: "Return the ordered stages of a pipeline (used as columns in the kanban view).",
      inputSchema: { account_id: optionalAccountId, pipeline_id: pipelineId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, pipeline_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}/stages`);
      }),
  );

  server.registerTool(
    "create_pipeline",
    {
      title: "Create pipeline",
      description: "Create a new pipeline (funnel) with stages.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1).describe("Pipeline name"),
        description: z.string().optional(),
        stages: z
          .array(
            z.object({
              name: z.string().describe("Stage name"),
              position: z.number().int().describe("Stage order (1-indexed)"),
              color: z.string().optional().describe("Hex color code"),
              probability: z.number().min(0).max(100).optional().describe("Win probability (%)"),
            }),
          )
          .optional()
          .describe("Initial stages (can also be added via update)"),
        inbox_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Link the pipeline to an inbox — cards are then auto-created from " +
              "that inbox's conversations. One inbox maps to at most one pipeline.",
          ),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/pipelines`, body);
      }),
  );

  // SAFETY: update_pipeline NÃO aceita `stages` no body — para edição de
  // stages, use as 3 tools cirúrgicas abaixo (update_pipeline_stage,
  // add_pipeline_stage, remove_pipeline_stage) que fazem GET + merge + PATCH
  // atomicamente. Chamadas de update_pipeline com stages parciais nas versões
  // anteriores movem cards silenciosamente — incident 2026-05-07.
  server.registerTool(
    "update_pipeline",
    {
      title: "Update pipeline metadata",
      description:
        "Update pipeline name, description, active flag, or settings. " +
        "Does NOT accept `stages` — use update_pipeline_stage / " +
        "add_pipeline_stage / remove_pipeline_stage for safe stage edits.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        name: z.string().optional(),
        description: z.string().optional(),
        active: z.boolean().optional(),
        inbox_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Link/relink the pipeline to an inbox (pass null to unlink)"),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, pipeline_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`, body);
      }),
  );

  // ── Stage edit tools (safe via GET + merge + PATCH) ──────────────────────
  // These avoid the destructive partial-update pattern that motivated the
  // 2026-05-07 incident. Each tool fetches the current pipeline, mutates only
  // the targeted stage, then PATCHes the full stages hash.

  const stageFieldsSchema = z
    .object({
      name: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      position: z.number().int().optional(),
      description: z.string().optional(),
      is_entry_stage: z.boolean().optional(),
      is_won_stage: z.boolean().optional(),
      is_lost_stage: z.boolean().optional(),
      wip_limit: z.number().int().optional(),
      sla_hours: z.number().int().optional(),
    })
    .passthrough();

  server.registerTool(
    "update_pipeline_stage",
    {
      title: "Update a single pipeline stage",
      description:
        "Edit one stage (description, color, name, position, flags) WITHOUT " +
        "affecting other stages. Internally: GET pipeline → merge → PATCH full " +
        "stages hash. Safe against the partial-update bug fixed on 2026-05-07.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        stage_id: z.string().min(1).describe("Stage id (e.g. '3321_qualificado')"),
        fields: stageFieldsSchema.describe(
          "Fields to merge into the existing stage. Only listed fields are touched.",
        ),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, pipeline_id, stage_id, fields }) =>
      safeHandler(async () => {
        const acc = resolveAccountId(account_id);
        const pipeline = (await client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`)) as {
          stages?: Record<string, Record<string, unknown>>;
        };
        const stages = { ...(pipeline.stages ?? {}) };
        if (!stages[stage_id]) {
          throw new Error(
            `Stage "${stage_id}" not found in pipeline ${pipeline_id}. Available: ${Object.keys(stages).join(", ")}`,
          );
        }
        stages[stage_id] = { ...stages[stage_id], ...fields };
        return client.patch(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`, {
          stages,
        });
      }),
  );

  server.registerTool(
    "add_pipeline_stage",
    {
      title: "Add a new stage to a pipeline",
      description:
        "Append a stage to the pipeline. Internally GET → merge → PATCH; " +
        "existing stages are preserved. The server normalizes the new stage id " +
        "to `{pipeline_id}_{slug}` after save.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        stage: stageFieldsSchema
          .extend({ name: z.string().min(1).describe("Stage name (required)") })
          .describe("Fields for the new stage. `name` is required."),
        temp_key: z
          .string()
          .optional()
          .describe(
            "Optional placeholder key used in the payload before normalize_stage_ids! runs. " +
              "Defaults to 'tmp_<random>'.",
          ),
      },
    },
    async ({ account_id, pipeline_id, stage, temp_key }) =>
      safeHandler(async () => {
        const acc = resolveAccountId(account_id);
        const pipeline = (await client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`)) as {
          stages?: Record<string, Record<string, unknown>>;
        };
        const stages = { ...(pipeline.stages ?? {}) };
        const placeholder = temp_key ?? `tmp_${Math.random().toString(36).slice(2, 9)}`;
        if (stages[placeholder]) {
          throw new Error(
            `Stage placeholder "${placeholder}" already exists; choose a different temp_key`,
          );
        }
        stages[placeholder] = stage;
        return client.patch(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`, {
          stages,
        });
      }),
  );

  server.registerTool(
    "remove_pipeline_stage",
    {
      title: "Remove a stage from a pipeline",
      description:
        "Remove a stage. Cards in the removed stage are auto-moved by the " +
        "backend to the first non-terminal stage by position. Internally: " +
        "GET → delete key → PATCH full stages hash.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        stage_id: z.string().min(1).describe("Stage id to remove"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, pipeline_id, stage_id }) =>
      safeHandler(async () => {
        const acc = resolveAccountId(account_id);
        const pipeline = (await client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`)) as {
          stages?: Record<string, Record<string, unknown>>;
        };
        const stages = { ...(pipeline.stages ?? {}) };
        if (!stages[stage_id]) {
          throw new Error(`Stage "${stage_id}" not found in pipeline ${pipeline_id}`);
        }
        delete stages[stage_id];
        return client.patch(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`, {
          stages,
        });
      }),
  );

  server.registerTool(
    "delete_pipeline",
    {
      title: "Delete pipeline",
      description:
        "Delete a pipeline. Cards are soft-deleted (recoverable via list_discarded_cards).",
      inputSchema: { account_id: accountIdSchema, pipeline_id: pipelineId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, pipeline_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}`);
      }),
  );

  // ── Stage-transition follow-up rules ───────────────────────────────────────
  server.registerTool(
    "list_pipeline_followup_rules",
    {
      title: "List pipeline follow-up rules",
      description:
        "List the follow-up rules of a pipeline, ordered by to_stage. Response: { payload: [rule] }.",
      inputSchema: { account_id: optionalAccountId, pipeline_id: pipelineId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, pipeline_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}/follow-up-rules`);
      }),
  );

  server.registerTool(
    "get_pipeline_followup_rule",
    {
      title: "Get pipeline follow-up rule",
      description: "Read one follow-up rule of a pipeline.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        rule_id: followUpRuleId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, pipeline_id, rule_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipelines/${pipeline_id}/follow-up-rules/${rule_id}`,
        );
      }),
  );

  server.registerTool(
    "create_pipeline_followup_rule",
    {
      title: "Create pipeline follow-up rule",
      description:
        "Schedule a follow-up whenever a card of this pipeline enters to_stage. Stages must exist in the pipeline; validation errors return 422 { errors: [...] }.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        to_stage: ruleStage.describe("Stage that triggers the rule when a card enters it"),
        ...followUpRuleFields,
      },
    },
    async ({ account_id, pipeline_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}/follow-up-rules`, {
          pipeline_follow_up_rule: body,
        });
      }),
  );

  server.registerTool(
    "update_pipeline_followup_rule",
    {
      title: "Update pipeline follow-up rule",
      description: "Update a pipeline follow-up rule. Only the fields sent are changed.",
      inputSchema: {
        account_id: optionalAccountId,
        pipeline_id: pipelineId,
        rule_id: followUpRuleId,
        to_stage: ruleStage.optional(),
        ...followUpRuleFields,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, pipeline_id, rule_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(
          `/api/v1/accounts/${acc}/pipelines/${pipeline_id}/follow-up-rules/${rule_id}`,
          { pipeline_follow_up_rule: body },
        );
      }),
  );

  server.registerTool(
    "delete_pipeline_followup_rule",
    {
      title: "Delete pipeline follow-up rule",
      description:
        "Delete a pipeline follow-up rule (204). Not reversible; requires administrator or follow_up_manage.",
      inputSchema: {
        account_id: accountIdSchema,
        pipeline_id: pipelineId,
        rule_id: followUpRuleId,
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, pipeline_id, rule_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/pipelines/${pipeline_id}/follow-up-rules/${rule_id}`,
        );
      }),
  );
};
