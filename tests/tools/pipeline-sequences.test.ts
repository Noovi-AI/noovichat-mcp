import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/pipeline-sequences.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: { annotations?: Record<string, unknown>; inputSchema?: z.ZodRawShape };
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

describe("pipeline-sequences tools — card execution contracts", () => {
  it("lists card sequences without unsupported pagination", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "list_card_sequences");

    expect(schema.shape.page).toBeUndefined();
    expect(schema.shape.per_page).toBeUndefined();

    await tools.get("list_card_sequences")?.handler({ account_id: 7, card_id: 42 });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/cards/42/sequences");
  });

  it("starts a card sequence with the controller's definition_id field only", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "start_card_sequence");

    expect(schema.shape.sequence_definition_id).toBeUndefined();
    expect(schema.shape.context).toBeUndefined();
    expect(schema.safeParse({ card_id: 42, definition_id: 8 }).success).toBe(true);
    expect(schema.safeParse({ card_id: 42, sequence_definition_id: 8 }).success).toBe(false);

    await tools.get("start_card_sequence")?.handler({
      account_id: 7,
      card_id: 42,
      definition_id: 8,
    });

    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/cards/42/sequences", {
      definition_id: 8,
    });
  });

  it("completes a step without the ignored outcome body or an idempotent hint", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "complete_sequence_step");

    expect(schema.shape.outcome).toBeUndefined();
    expect(tools.get("complete_sequence_step")?.config.annotations?.idempotentHint).toBeUndefined();

    await tools.get("complete_sequence_step")?.handler({
      account_id: 7,
      card_id: 42,
      sequence_id: 12,
    });

    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/accounts/7/pipeline/cards/42/sequences/12/complete_step",
    );
  });

  it("keeps cancellation destructive and explicitly account-scoped", () => {
    const { tools } = setupTools();
    const schema = toolSchema(tools, "delete_card_sequence");

    expect(schema.safeParse({ card_id: 42, sequence_id: 12 }).success).toBe(false);
    expect(schema.safeParse({ account_id: 7, card_id: 42, sequence_id: 12 }).success).toBe(true);
    expect(tools.get("delete_card_sequence")?.config.annotations?.destructiveHint).toBe(true);
  });
});

describe("pipeline-sequences tools — external start and analytics", () => {
  it("maps external_start to definition_id plus the allowlisted context", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "external_start_sequence");
    const context = {
      trigger_source: "n8n-flow-onboarding",
      external_id: "lead-123",
      metadata: { campaign_id: "campaign-7" },
    };

    expect(schema.shape.sequence_definition_id).toBeUndefined();
    expect(schema.shape.source).toBeUndefined();
    expect(schema.shape.external_payload).toBeUndefined();
    expect(schema.safeParse({ card_id: 42, definition_id: 8, context }).success).toBe(true);
    expect(
      schema.safeParse({ card_id: 42, definition_id: 8, context: { arbitrary: true } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ card_id: 42, definition_id: 8, context: { notes: "x".repeat(10_001) } })
        .success,
    ).toBe(false);

    await tools.get("external_start_sequence")?.handler({
      account_id: 7,
      card_id: 42,
      definition_id: 8,
      context,
    });

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/pipeline/cards/42/sequences/external_start",
      { definition_id: 8, context },
    );
  });

  it("uses the only analytics filter implemented by the controller", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "get_sequence_analytics");

    expect(schema.shape.sequence_definition_id).toBeUndefined();
    expect(schema.shape.from).toBeUndefined();
    expect(schema.shape.to).toBeUndefined();
    expect(schema.safeParse({ days_back: 1 }).success).toBe(true);
    expect(schema.safeParse({ days_back: 90 }).success).toBe(true);
    expect(schema.safeParse({ days_back: 91 }).success).toBe(false);

    await tools.get("get_sequence_analytics")?.handler({ account_id: 7, days_back: 30 });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/sequence_analytics", {
      days_back: 30,
    });
  });
});
