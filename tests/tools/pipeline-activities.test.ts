import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/pipeline-activities.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: {
    annotations?: Record<string, unknown>;
    description?: string;
    inputSchema?: z.ZodRawShape;
  };
  handler: Handler;
}

function setupTools() {
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

function toolSchema(tools: Map<string, RegisteredTool>, name: string) {
  const shape = tools.get(name)?.config.inputSchema;
  if (!shape) throw new Error(`Missing input schema for ${name}`);

  return z.object(shape);
}

describe("pipeline-activities tools — sequence definition trigger contract", () => {
  it("filters the sequence list by the backend trigger_type enum", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "list_activity_sequences");

    expect(schema.safeParse({ trigger_type: "time_based" }).success).toBe(true);
    expect(schema.safeParse({ trigger_type: "scheduled" }).success).toBe(false);

    await tools.get("list_activity_sequences")?.handler({
      account_id: 7,
      active: true,
      trigger_type: "time_based",
      page: 2,
    });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/activity_sequences", {
      active: true,
      trigger_type: "time_based",
      page: 2,
    });
  });

  it("creates a time-based definition with the current wrapper and delay fields", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "create_activity_sequence");
    const input = {
      name: "Weekday follow-up",
      trigger_type: "time_based",
      trigger_conditions: { cron_expression: "0 9 * * 1-5" },
      steps: [
        {
          step_number: 1,
          activity_type: "call",
          title: "Call the lead",
          delay_days: 0,
          delay_hours: 1,
        },
      ],
    };

    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, steps: [] }).success).toBe(false);
    expect(
      schema.safeParse({
        ...input,
        trigger_conditions: { every_n_days: 0 },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...input,
        trigger_conditions: { cron_expression: "0 9 * * 1", every_n_days: 7 },
      }).success,
    ).toBe(false);

    await tools.get("create_activity_sequence")?.handler({ account_id: 7, ...input });

    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/activity_sequences", {
      pipeline_activity_sequence: input,
    });
  });

  it("accepts canonical stage and condition trigger payloads", () => {
    const { tools } = setupTools();
    const schema = toolSchema(tools, "create_activity_sequence");
    const steps = [{ activity_type: "task", title: "Review" }];

    expect(
      schema.safeParse({
        name: "Stage follow-up",
        trigger_type: "stage_change",
        trigger_conditions: {
          funnel_id: 9,
          from_stage_id: "lead",
          to_stage_id: "qualified",
        },
        steps,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        name: "High score",
        trigger_type: "condition_based",
        trigger_conditions: { field: "lead_score", operator: ">=", value: 80 },
        steps,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        name: "Missing destination",
        trigger_type: "stage_change",
        trigger_conditions: { funnel_id: 9 },
        steps,
      }).success,
    ).toBe(false);
  });

  it("updates trigger fields through PATCH without changing their names", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "update_activity_sequence");
    const update = {
      trigger_type: "time_based",
      trigger_conditions: { every_n_days: 7, eligibility_filter: { days_in_stage: 3 } },
      active: false,
    };

    expect(schema.safeParse({ sequence_id: 12, ...update }).success).toBe(true);
    expect(schema.safeParse({ sequence_id: 12, steps: [] }).success).toBe(false);

    await tools.get("update_activity_sequence")?.handler({
      account_id: 7,
      sequence_id: 12,
      ...update,
    });

    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/activity_sequences/12", {
      pipeline_activity_sequence: update,
    });
    expect(tools.get("update_activity_sequence")?.config.annotations?.idempotentHint).toBe(true);
  });
});

describe("pipeline-activities tools — sequence lifecycle contract", () => {
  it("uses the activation and deactivation member routes", async () => {
    const { tools, client } = setupTools();

    await tools.get("activate_activity_sequence")?.handler({ account_id: 7, sequence_id: 12 });
    await tools.get("deactivate_activity_sequence")?.handler({ account_id: 7, sequence_id: 12 });

    expect(client.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/accounts/7/pipeline/activity_sequences/12/activate",
    );
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/accounts/7/pipeline/activity_sequences/12/deactivate",
    );
    expect(tools.get("activate_activity_sequence")?.config.description).toContain(
      "account administrator",
    );
    expect(tools.get("deactivate_activity_sequence")?.config.description).toContain(
      "pause its active executions",
    );
  });
});
