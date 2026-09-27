import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register as registerFollowUps } from "../../src/tools/follow-ups.js";
import { register as registerActivities } from "../../src/tools/pipeline-activities.js";
import { register as registerAnalytics } from "../../src/tools/pipeline-analytics.js";
import { register as registerAutomations } from "../../src/tools/pipeline-automations.js";
import { register as registerCards } from "../../src/tools/pipeline-cards.js";
import { register as registerOpportunities } from "../../src/tools/pipeline-opportunities.js";
import { register as registerPipelines } from "../../src/tools/pipelines.js";
import type { RegisterFn } from "../../src/types.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: { annotations?: Record<string, unknown>; inputSchema?: z.ZodRawShape };
  handler: Handler;
}

function setup(register: RegisterFn) {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: RegisteredTool["config"], handler: Handler) {
      tools.set(name, { config, handler });
    },
  };
  const client = {
    get: vi.fn(async () => ({ ok: true })),
    post: vi.fn(async () => ({ ok: true })),
    patch: vi.fn(async () => ({ ok: true })),
    put: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => ({ ok: true })),
  };
  register(server as never, client as unknown as NooviChatClient);
  return { tools, client };
}

type Verb = "get" | "post" | "patch" | "delete";

interface RouteCase {
  register: RegisterFn;
  tool: string;
  input: Record<string, unknown>;
  verb: Verb;
  path: string;
  // Second argument the handler must pass (query params or body). Omit when
  // the call must carry no second argument at all.
  arg?: unknown;
  hint?: "readOnlyHint" | "idempotentHint" | "destructiveHint";
}

// Each row mirrors a real Chatwoot route (config/routes.rb) and the params the
// controller reads. Account 7 is passed explicitly so env fallback is not used.
const cases: RouteCase[] = [
  // Pipeline follow-up rules (PipelineFollowUpRulesController)
  {
    register: registerPipelines,
    tool: "list_pipeline_followup_rules",
    input: { account_id: 7, pipeline_id: 3 },
    verb: "get",
    path: "/api/v1/accounts/7/pipelines/3/follow-up-rules",
    hint: "readOnlyHint",
  },
  {
    register: registerPipelines,
    tool: "get_pipeline_followup_rule",
    input: { account_id: 7, pipeline_id: 3, rule_id: 9 },
    verb: "get",
    path: "/api/v1/accounts/7/pipelines/3/follow-up-rules/9",
    hint: "readOnlyHint",
  },
  {
    register: registerPipelines,
    tool: "create_pipeline_followup_rule",
    input: {
      account_id: 7,
      pipeline_id: 3,
      to_stage: "3_proposta",
      content_mode: "ai",
      ai_instruction: "Nudge the lead",
      send_window: { enabled: true, days: [1, 2], start: "08:00", end: "18:00" },
    },
    verb: "post",
    path: "/api/v1/accounts/7/pipelines/3/follow-up-rules",
    arg: {
      pipeline_follow_up_rule: {
        to_stage: "3_proposta",
        content_mode: "ai",
        ai_instruction: "Nudge the lead",
        send_window: { enabled: true, days: [1, 2], start: "08:00", end: "18:00" },
      },
    },
  },
  {
    register: registerPipelines,
    tool: "update_pipeline_followup_rule",
    input: { account_id: 7, pipeline_id: 3, rule_id: 9, enabled: false },
    verb: "patch",
    path: "/api/v1/accounts/7/pipelines/3/follow-up-rules/9",
    arg: { pipeline_follow_up_rule: { enabled: false } },
    hint: "idempotentHint",
  },
  {
    register: registerPipelines,
    tool: "delete_pipeline_followup_rule",
    input: { account_id: 7, pipeline_id: 3, rule_id: 9 },
    verb: "delete",
    path: "/api/v1/accounts/7/pipelines/3/follow-up-rules/9",
    hint: "destructiveHint",
  },
  // Cards: namespaced index, attachments, legacy forced recalculation
  {
    register: registerCards,
    tool: "list_cards_paged",
    input: { account_id: 7, owner_id: 4, lead_score_category: "hot", page: 2, per_page: 50 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/cards",
    arg: { owner_id: 4, lead_score_category: "hot", page: 2, per_page: 50 },
    hint: "readOnlyHint",
  },
  {
    register: registerCards,
    tool: "list_card_attachments",
    input: { account_id: 7, card_id: 11 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/cards/11/attachments",
    hint: "readOnlyHint",
  },
  {
    register: registerCards,
    tool: "delete_card_attachment",
    input: { account_id: 7, card_id: 11, attachment_id: 5 },
    verb: "delete",
    path: "/api/v1/accounts/7/pipeline/cards/11/attachments/5",
    hint: "destructiveHint",
  },
  {
    register: registerCards,
    tool: "delete_card_note_attachment",
    input: { account_id: 7, card_id: 11, attachment_id: 5 },
    verb: "delete",
    path: "/api/v1/accounts/7/pipeline/cards/11/note_attachments/5",
    hint: "destructiveHint",
  },
  {
    register: registerCards,
    tool: "force_recalculate_card_lead_score",
    input: { account_id: 7, card_id: 11 },
    verb: "post",
    path: "/api/v1/accounts/7/pipeline_cards/11/recalculate_score",
  },
  // Automation webhook credentials
  {
    register: registerAutomations,
    tool: "get_automation_webhook_credentials",
    input: { account_id: 7, automation_id: 2 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/automations/2/webhook_credentials",
    hint: "readOnlyHint",
  },
  {
    register: registerAutomations,
    tool: "rotate_automation_webhook_token",
    input: { account_id: 7, automation_id: 2 },
    verb: "post",
    path: "/api/v1/accounts/7/pipeline/automations/2/rotate_webhook_token",
    hint: "destructiveHint",
  },
  // Sequence webhook credentials
  {
    register: registerActivities,
    tool: "get_sequence_webhook_credentials",
    input: { account_id: 7 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/activity_sequences/webhook_credentials",
    hint: "readOnlyHint",
  },
  {
    register: registerActivities,
    tool: "rotate_sequence_webhook_credentials",
    input: { account_id: 7, credential_scope: "outbound" },
    verb: "post",
    path: "/api/v1/accounts/7/pipeline/activity_sequences/rotate_webhook_credentials",
    arg: { credential_scope: "outbound" },
    hint: "destructiveHint",
  },
  {
    register: registerActivities,
    tool: "list_activity_templates",
    input: { account_id: 7, activity_type: "call", active: true, sort: "most_used" },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/activity_templates",
    arg: { activity_type: "call", active: true, sort: "most_used" },
    hint: "readOnlyHint",
  },
  // Follow-up template items and attachments
  {
    register: registerFollowUps,
    tool: "get_followup_template_item",
    input: { account_id: 7, template_id: 8, item_id: 1 },
    verb: "get",
    path: "/api/v1/accounts/7/follow-up-templates/8/items/1",
    hint: "readOnlyHint",
  },
  {
    register: registerFollowUps,
    tool: "update_followup_template_item",
    input: { account_id: 7, template_id: 8, item_id: 1, delay_seconds: 3600 },
    verb: "patch",
    path: "/api/v1/accounts/7/follow-up-templates/8/items/1",
    arg: { follow_up_template_item: { delay_seconds: 3600 } },
    hint: "idempotentHint",
  },
  {
    register: registerFollowUps,
    tool: "reorder_followup_template_items",
    input: { account_id: 7, template_id: 8, item_ids: [3, 1, 2] },
    verb: "post",
    path: "/api/v1/accounts/7/follow-up-templates/8/items/reorder",
    // FollowUpTemplateItemsController#reorder reads params[:items]; anything
    // else is a 400.
    arg: { items: [{ id: 3 }, { id: 1 }, { id: 2 }] },
  },
  {
    register: registerFollowUps,
    tool: "delete_followup_template_attachment",
    input: { account_id: 7, template_id: 8, attachment_id: 44 },
    verb: "delete",
    path: "/api/v1/accounts/7/follow-up-templates/8/attachments/44",
    hint: "destructiveHint",
  },
  // Products and opportunities
  {
    register: registerOpportunities,
    tool: "list_pipeline_products",
    input: { account_id: 7, active_only: true, per_page: 20, offset: 40 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/products",
    arg: { active_only: true, per_page: 20, offset: 40 },
    hint: "readOnlyHint",
  },
  {
    register: registerOpportunities,
    tool: "get_pipeline_products_performance",
    input: { account_id: 7, won_start: "2026-09-01", won_end: "2026-09-30" },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/products/performance",
    arg: { won_start: "2026-09-01", won_end: "2026-09-30" },
    hint: "readOnlyHint",
  },
  {
    register: registerOpportunities,
    tool: "get_pipeline_product",
    input: { account_id: 7, product_id: 6 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/products/6",
    hint: "readOnlyHint",
  },
  {
    register: registerOpportunities,
    tool: "create_pipeline_product",
    input: { account_id: 7, name: "Plano anual", default_value: 1200, pipeline_ids: [3] },
    verb: "post",
    path: "/api/v1/accounts/7/pipeline/products",
    arg: { pipeline_product: { name: "Plano anual", default_value: 1200, pipeline_ids: [3] } },
  },
  {
    register: registerOpportunities,
    tool: "update_pipeline_product",
    input: { account_id: 7, product_id: 6, active: true },
    verb: "patch",
    path: "/api/v1/accounts/7/pipeline/products/6",
    arg: { pipeline_product: { active: true } },
    hint: "idempotentHint",
  },
  {
    register: registerOpportunities,
    tool: "deactivate_pipeline_product",
    input: { account_id: 7, product_id: 6 },
    verb: "delete",
    path: "/api/v1/accounts/7/pipeline/products/6",
    hint: "destructiveHint",
  },
  {
    register: registerOpportunities,
    tool: "list_card_opportunities",
    input: { account_id: 7, card_id: 11, per_page: 10 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/cards/11/opportunities",
    arg: { per_page: 10 },
    hint: "readOnlyHint",
  },
  {
    register: registerOpportunities,
    tool: "record_card_opportunity",
    input: {
      account_id: 7,
      card_id: 11,
      title: "Upsell",
      items: [{ pipeline_product_id: 6, quantity: 2, unit_value: "150.00" }],
    },
    verb: "post",
    path: "/api/v1/accounts/7/pipeline/cards/11/opportunities",
    // Root-level fields: OpportunitiesController reads params[:items] etc.
    arg: {
      title: "Upsell",
      items: [{ pipeline_product_id: 6, quantity: 2, unit_value: "150.00" }],
    },
  },
  {
    register: registerOpportunities,
    tool: "void_opportunity",
    input: { account_id: 7, opportunity_id: 30, reason: "Duplicated entry" },
    verb: "post",
    path: "/api/v1/accounts/7/pipeline/opportunities/30/void",
    arg: { reason: "Duplicated entry" },
    hint: "destructiveHint",
  },
  {
    register: registerOpportunities,
    tool: "get_opportunities_report",
    input: { account_id: 7, start_date: "2026-09-01", end_date: "2026-09-30", pipeline_id: 3 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/opportunities/report",
    arg: { start_date: "2026-09-01", end_date: "2026-09-30", pipeline_id: 3 },
    hint: "readOnlyHint",
  },
  // Analytics, owners and lost reasons
  ...(
    [
      ["get_pipeline_win_rate", "analytics/win_rate", { pipeline_id: 3 }],
      ["get_pipeline_sales_velocity", "analytics/sales_velocity", { start_date: "2026-09-01" }],
      ["get_pipeline_forecast", "analytics/forecast", { months_ahead: 6 }],
      ["get_pipeline_conversion_metrics", "analytics/conversion_metrics", { pipeline_id: 3 }],
      ["get_pipeline_analysis", "analytics/pipeline_analysis", { pipeline_id: 3 }],
      [
        "get_pipeline_dashboard",
        "analytics/pipeline_dashboard",
        { pipeline_id: 3, date_start: "2026-09-01", date_end: "2026-09-30", activity_per_page: 20 },
      ],
      ["export_pipeline_analytics", "analytics/export", { pipeline_id: 3 }],
      ["get_lost_reasons_analytics", "deal_status/lost_reasons", { end_date: "2026-09-30" }],
    ] as const
  ).map(
    ([tool, suffix, params]): RouteCase => ({
      register: registerAnalytics,
      tool,
      input: { account_id: 7, ...params },
      verb: "get",
      path: `/api/v1/accounts/7/pipeline/${suffix}`,
      arg: params,
      hint: "readOnlyHint",
    }),
  ),
  {
    register: registerAnalytics,
    tool: "get_agent_pipeline_metrics",
    input: { account_id: 7, user_id: 4 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/analytics/pipeline/4",
    hint: "readOnlyHint",
  },
  {
    register: registerAnalytics,
    tool: "get_team_pipeline",
    input: { account_id: 7 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/analytics/team_pipeline",
    hint: "readOnlyHint",
  },
  {
    register: registerAnalytics,
    tool: "list_common_lost_reasons",
    input: { account_id: 7 },
    verb: "get",
    path: "/api/v1/accounts/7/pipeline/deal_status/common_reasons",
    hint: "readOnlyHint",
  },
];

describe("pipeline route coverage — tools hit the real Chatwoot routes", () => {
  it.each(cases.map((c) => [c.tool, c] as const))("%s", async (_name, c) => {
    const { tools, client } = setup(c.register);
    const tool = tools.get(c.tool);
    expect(tool, `tool ${c.tool} is not registered`).toBeDefined();

    const shape = tool?.config.inputSchema;
    expect(shape).toBeDefined();
    const parsed = z.object(shape as z.ZodRawShape).safeParse(c.input);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    await tool?.handler(parsed.success ? parsed.data : c.input);

    const call = client[c.verb].mock.calls[0] as unknown[] | undefined;
    expect(call?.[0]).toBe(c.path);
    if ("arg" in c) {
      expect(call?.[1]).toEqual(c.arg);
    } else {
      expect(call?.[1]).toBeUndefined();
    }

    if (c.hint) {
      expect(tool?.config.annotations?.[c.hint]).toBe(true);
    }
    if (c.hint !== "destructiveHint") {
      expect(tool?.config.annotations?.destructiveHint).not.toBe(true);
    }
  });
});

describe("pipeline route coverage — contract details", () => {
  it("delete_card keeps the legacy route without a reason and records it on the namespaced one", async () => {
    const { tools, client } = setup(registerCards);
    const tool = tools.get("delete_card");
    expect(tool?.config.annotations?.destructiveHint).toBe(true);

    await tool?.handler({ account_id: 7, card_id: 11 });
    expect(client.delete).toHaveBeenLastCalledWith("/api/v1/accounts/7/pipeline_cards/11");

    await tool?.handler({ account_id: 7, card_id: 11, reason: "Lead duplicado" });
    expect(client.delete).toHaveBeenLastCalledWith("/api/v1/accounts/7/pipeline/cards/11", {
      reason: "Lead duplicado",
    });
  });

  it("rotate_sequence_webhook_credentials sends an empty body when no scope is given (server default: all)", async () => {
    const { tools, client } = setup(registerActivities);
    await tools.get("rotate_sequence_webhook_credentials")?.handler({ account_id: 7 });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/pipeline/activity_sequences/rotate_webhook_credentials",
      {},
    );
  });

  it("credential-rotating and destructive tools require an explicit account_id", () => {
    const required: Array<[RegisterFn, string]> = [
      [registerAutomations, "rotate_automation_webhook_token"],
      [registerActivities, "rotate_sequence_webhook_credentials"],
      [registerCards, "delete_card_attachment"],
      [registerCards, "delete_card_note_attachment"],
      [registerFollowUps, "delete_followup_template_attachment"],
      [registerOpportunities, "deactivate_pipeline_product"],
      [registerOpportunities, "void_opportunity"],
      [registerPipelines, "delete_pipeline_followup_rule"],
    ];
    for (const [register, name] of required) {
      const { tools } = setup(register);
      const schema = z.object(tools.get(name)?.config.inputSchema as z.ZodRawShape);
      const withoutAccount = schema.safeParse({
        automation_id: 1,
        card_id: 1,
        attachment_id: 1,
        template_id: 1,
        product_id: 1,
        opportunity_id: 1,
        reason: "x",
        pipeline_id: 1,
        rule_id: 1,
      });
      expect(withoutAccount.success, `${name} accepted a missing account_id`).toBe(false);
    }
  });

  it("void_opportunity rejects a missing reason and rotate scope rejects unknown values", () => {
    const { tools } = setup(registerOpportunities);
    const voidSchema = z.object(tools.get("void_opportunity")?.config.inputSchema as z.ZodRawShape);
    expect(voidSchema.safeParse({ account_id: 7, opportunity_id: 1 }).success).toBe(false);

    const activities = setup(registerActivities);
    const rotateSchema = z.object(
      activities.tools.get("rotate_sequence_webhook_credentials")?.config
        .inputSchema as z.ZodRawShape,
    );
    expect(rotateSchema.safeParse({ account_id: 7, credential_scope: "both" }).success).toBe(false);
  });

  it("pipeline_dashboard and opportunity dates reject non-ISO calendar dates", () => {
    const analytics = setup(registerAnalytics);
    const dash = z.object(
      analytics.tools.get("get_pipeline_dashboard")?.config.inputSchema as z.ZodRawShape,
    );
    expect(dash.safeParse({ pipeline_id: 3, date_start: "01/09/2026" }).success).toBe(false);

    const opp = setup(registerOpportunities);
    const report = z.object(
      opp.tools.get("get_opportunities_report")?.config.inputSchema as z.ZodRawShape,
    );
    expect(report.safeParse({ start_date: "2026-9-1" }).success).toBe(false);
  });
});
