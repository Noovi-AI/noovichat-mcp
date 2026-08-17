import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/pipeline-cards.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: { annotations?: Record<string, unknown>; inputSchema?: z.ZodRawShape };
  handler: Handler;
}

function makeStubServer() {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: RegisteredTool["config"], handler: Handler) {
      tools.set(name, { config, handler });
    },
  };
  return { server, tools };
}

function makeMockClient() {
  return {
    get: vi.fn(async () => ({ ok: true })),
    post: vi.fn(async () => ({ ok: true })),
    patch: vi.fn(async () => ({ ok: true })),
    put: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => ({ ok: true })),
  };
}

function setupTools() {
  const { server, tools } = makeStubServer();
  const client = makeMockClient();
  register(server as never, client as unknown as NooviChatClient);
  return { tools, client };
}

function toolSchema(tools: Map<string, RegisteredTool>, name: string) {
  const shape = tools.get(name)?.config.inputSchema;
  if (!shape) throw new Error(`Missing input schema for ${name}`);

  return z.object(shape);
}

describe("pipeline-cards tools — list and export contracts", () => {
  it("uses the exact legacy cursor and filter names", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "list_cards");

    expect(schema.shape.page).toBeUndefined();
    expect(schema.shape.per_page).toBeUndefined();
    expect(schema.shape.stage_id).toBeUndefined();
    expect(schema.shape.owner_id).toBeUndefined();
    expect(schema.shape.qualification).toBeUndefined();
    expect(
      schema.safeParse({
        limit: 500,
        cursor: "opaque-next-cursor",
        offset: 0,
        search: "Acme",
        pipeline_stage: "9_qualified",
        agent_id: "unassigned",
        priority: ["none", "urgent"],
        status: "closed",
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ limit: 501 }).success).toBe(false);
    expect(schema.safeParse({ offset: -1 }).success).toBe(false);
    expect(schema.safeParse({ offset: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ cursor: 123 }).success).toBe(false);
    expect(schema.safeParse({ search: "x".repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ priority: "urgent" }).success).toBe(false);
    expect(schema.safeParse({ agent_id: "someone" }).success).toBe(false);

    await tools.get("list_cards")?.handler({
      account_id: 7,
      status: "closed",
      search: "Acme",
      pipeline_stage: "9_qualified",
      agent_id: "unassigned",
      priority: ["none", "urgent"],
      limit: 500,
      cursor: "opaque-next-cursor",
      offset: 0,
    });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline_cards", {
      status: "closed",
      search: "Acme",
      pipeline_stage: "9_qualified",
      agent_id: "unassigned",
      priority: ["none", "urgent"],
      limit: 500,
      cursor: "opaque-next-cursor",
      offset: 0,
    });
  });

  it("keeps cursor filters when listing cards through a pipeline-scoped route", async () => {
    const { tools, client } = setupTools();

    await tools.get("list_cards")?.handler({
      account_id: 7,
      pipeline_id: 9,
      pipeline_stage: "9_qualified",
      search: "Acme",
      limit: 100,
      cursor: "next-page",
    });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipelines/9/pipeline_cards", {
      pipeline_stage: "9_qualified",
      search: "Acme",
      limit: 100,
      cursor: "next-page",
    });
  });

  it("shares the bounded search filter with export_cards", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "export_cards");

    expect(schema.safeParse({ search: "x".repeat(200) }).success).toBe(true);
    expect(schema.safeParse({ search: "x".repeat(201) }).success).toBe(false);

    await tools.get("export_cards")?.handler({
      account_id: 7,
      pipeline_id: 9,
      pipeline_stage: "9_qualified",
      priority: ["none"],
      search: "Acme",
    });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/cards/export", {
      pipeline_id: 9,
      pipeline_stage: "9_qualified",
      priority: ["none"],
      search: "Acme",
    });
  });
});

describe("pipeline-cards tools — currency contract", () => {
  it("validates and forwards currency when creating a card", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "create_card");
    const required = {
      pipeline_id: 9,
      pipeline_stage: "9_qualified",
      title: "Acme renewal",
    };

    expect(schema.safeParse({ ...required, currency: "BRL" }).success).toBe(true);
    expect(schema.safeParse({ ...required, currency: "brl" }).success).toBe(false);
    expect(schema.safeParse({ ...required, currency: "USDT" }).success).toBe(false);

    await tools.get("create_card")?.handler({
      account_id: 7,
      ...required,
      expected_revenue: 1250,
      currency: "BRL",
    });

    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline_cards", {
      pipeline_card: {
        ...required,
        expected_revenue: 1250,
        currency: "BRL",
      },
    });
  });

  it("validates and forwards currency when updating a card", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "update_card");

    expect(schema.safeParse({ card_id: 42, currency: "USD" }).success).toBe(true);
    expect(schema.safeParse({ card_id: 42, currency: "usd" }).success).toBe(false);

    await tools.get("update_card")?.handler({
      account_id: 7,
      card_id: 42,
      expected_revenue: 2500,
      currency: "USD",
    });

    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline_cards/42", {
      pipeline_card: {
        expected_revenue: 2500,
        currency: "USD",
      },
    });
  });
});

describe("pipeline-cards tools — mutation payload contracts", () => {
  it("uses pipeline_stage and forwards only the move action fields", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "move_card_to_stage");

    expect(schema.shape.pipeline_stage_id).toBeUndefined();
    expect(schema.shape.position).toBeUndefined();
    expect(
      schema.safeParse({
        card_id: 42,
        pipeline_stage: "9_won",
        won_value: 1200,
        won_note: "Signed",
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ card_id: 42, pipeline_stage_id: "9_won" }).success).toBe(false);

    await tools.get("move_card_to_stage")?.handler({
      account_id: 7,
      card_id: 42,
      pipeline_stage: "9_won",
      won_value: 1200,
      won_note: "Signed",
    });

    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline_cards/42/move_to_stage", {
      pipeline_stage: "9_won",
      won_value: 1200,
      won_note: "Signed",
    });
  });

  it("sends the pipeline-scoped positions vector expected by reorder", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "reorder_cards");
    const positions = [
      { id: 42, position: 0, pipeline_stage: "9_lead" },
      { id: 43, position: 1, pipeline_stage: "9_lead" },
    ];

    expect(schema.shape.pipeline_stage_id).toBeUndefined();
    expect(schema.shape.card_ids).toBeUndefined();
    expect(schema.safeParse({ pipeline_id: 9, positions }).success).toBe(true);
    expect(schema.safeParse({ pipeline_id: 9, positions: [{ id: 42, position: 0 }] }).success).toBe(
      false,
    );

    await tools.get("reorder_cards")?.handler({ account_id: 7, pipeline_id: 9, positions });

    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline_cards/reorder", {
      pipeline_id: 9,
      positions,
    });
  });

  it("sends structured qualification criteria under qualification_checklist", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "update_card_qualification_checklist");
    const qualification_checklist = {
      budget: {
        id: "budget",
        name: "Budget confirmed",
        checked: true,
        points: 20,
        required: true,
        category: "financial",
        notes: "Approved",
      },
    };

    expect(schema.shape.checklist).toBeUndefined();
    expect(schema.safeParse({ card_id: 42, qualification_checklist }).success).toBe(true);
    expect(
      schema.safeParse({ card_id: 42, qualification_checklist: { budget: true } }).success,
    ).toBe(false);

    await tools.get("update_card_qualification_checklist")?.handler({
      account_id: 7,
      card_id: 42,
      qualification_checklist,
    });

    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/accounts/7/pipeline_cards/42/update_qualification_checklist",
      { qualification_checklist },
    );
  });

  it("accepts the backend's none priority in writes and bulk filters", async () => {
    const { tools, client } = setupTools();

    expect(
      toolSchema(tools, "create_card").safeParse({
        pipeline_id: 9,
        pipeline_stage: "9_lead",
        priority: "none",
      }).success,
    ).toBe(true);
    expect(
      toolSchema(tools, "bulk_set_card_priority").safeParse({
        card_ids: [42],
        priority: "none",
        pipeline_stage: "9_lead",
      }).success,
    ).toBe(true);

    await tools.get("bulk_set_card_priority")?.handler({
      account_id: 7,
      card_ids: [42],
      priority: "none",
      pipeline_stage: "9_lead",
    });

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/pipeline/bulk_actions/set_priority",
      { card_ids: [42], priority: "none", pipeline_stage: "9_lead" },
    );
  });
});

describe("pipeline-cards tools — analytics dashboard contract", () => {
  it("uses start_date/end_date and does not promise a pipeline filter", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "get_pipeline_analytics_dashboard");

    expect(schema.shape.pipeline_id).toBeUndefined();
    expect(schema.shape.from).toBeUndefined();
    expect(schema.shape.to).toBeUndefined();
    expect(schema.safeParse({ start_date: "2026-07-01", end_date: "2026-07-19" }).success).toBe(
      true,
    );

    await tools.get("get_pipeline_analytics_dashboard")?.handler({
      account_id: 7,
      start_date: "2026-07-01",
      end_date: "2026-07-19",
    });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/analytics/dashboard", {
      start_date: "2026-07-01",
      end_date: "2026-07-19",
    });
  });
});

// FR2 (Chatwoot v4.15.1.12) — additive non-primary contacts/conversations.
describe("pipeline-cards tools — additional contacts (FR2)", () => {
  it("registers add_card_contact and posts to the card contacts route", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    expect(tools.has("add_card_contact")).toBe(true);
    // Additive link, not destructive.
    expect(tools.get("add_card_contact")?.config.annotations?.destructiveHint).toBeUndefined();

    await tools.get("add_card_contact")?.handler({
      account_id: 7,
      card_id: 42,
      contact_id: 99,
      role: "decision_maker",
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/cards/42/contacts", {
      contact_id: 99,
      role: "decision_maker",
    });
  });

  it("registers remove_card_contact as destructive and deletes by link id", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    expect(tools.get("remove_card_contact")?.config.annotations?.destructiveHint).toBe(true);

    await tools.get("remove_card_contact")?.handler({ account_id: 7, card_id: 42, id: 5 });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/cards/42/contacts/5");
  });
});

describe("pipeline-cards tools — additional conversations (FR2)", () => {
  it("registers add_card_conversation and posts by conversation_display_id", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    expect(tools.has("add_card_conversation")).toBe(true);
    expect(tools.get("add_card_conversation")?.config.annotations?.destructiveHint).toBeUndefined();

    await tools.get("add_card_conversation")?.handler({
      account_id: 7,
      card_id: 42,
      conversation_display_id: 1234,
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/cards/42/conversations", {
      conversation_display_id: 1234,
    });
  });

  it("registers remove_card_conversation as destructive and deletes by link id", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    expect(tools.get("remove_card_conversation")?.config.annotations?.destructiveHint).toBe(true);

    await tools.get("remove_card_conversation")?.handler({ account_id: 7, card_id: 42, id: 8 });
    expect(client.delete).toHaveBeenCalledWith(
      "/api/v1/accounts/7/pipeline/cards/42/conversations/8",
    );
  });
});
