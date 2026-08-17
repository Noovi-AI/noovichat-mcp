import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/pipeline-webhooks.js";

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

describe("pipeline-webhooks tools — managed outbound webhooks", () => {
  it("lists webhooks without unsupported filters or pagination", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "list_pipeline_webhooks");

    expect(schema.shape.enabled).toBeUndefined();
    expect(schema.shape.page).toBeUndefined();
    expect(schema.shape.per_page).toBeUndefined();

    await tools.get("list_pipeline_webhooks")?.handler({ account_id: 7 });

    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/webhooks");
  });

  it("requires an HTTP(S) URL and wraps the create payload", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "create_pipeline_webhook");
    const webhook = {
      name: "CRM deliveries",
      pipeline_id: 9,
      url: "https://hooks.example.com/pipeline",
      events: ["pipeline_card_created"],
      active: true,
    };

    expect(schema.safeParse(webhook).success).toBe(true);
    expect(schema.safeParse({ ...webhook, url: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...webhook, url: "ftp://example.com/hook" }).success).toBe(false);
    // O estouro de SLA é assinável como qualquer outro evento: sem isto, o
    // único evento que nasce de um relógio ficaria inalcançável pelo MCP.
    expect(schema.safeParse({ ...webhook, events: ["pipeline_card_sla_exceeded"] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...webhook, events: ["evento_inexistente"] }).success).toBe(false);

    await tools.get("create_pipeline_webhook")?.handler({ account_id: 7, ...webhook });

    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/webhooks", {
      pipeline_webhook: webhook,
    });
  });

  it("can clear pipeline_id while updating the wrapped webhook", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "update_pipeline_webhook");

    expect(schema.safeParse({ webhook_id: 3, pipeline_id: null }).success).toBe(true);
    expect(schema.safeParse({ webhook_id: 3, events: [] }).success).toBe(false);

    await tools.get("update_pipeline_webhook")?.handler({
      account_id: 7,
      webhook_id: 3,
      pipeline_id: null,
      active: false,
    });

    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/webhooks/3", {
      pipeline_webhook: { pipeline_id: null, active: false },
    });
  });

  it("uses the fixed server-generated test payload", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "test_pipeline_webhook");

    expect(schema.shape.sample_payload).toBeUndefined();

    await tools.get("test_pipeline_webhook")?.handler({ account_id: 7, webhook_id: 3 });

    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/pipeline/webhooks/3/test");
  });

  it("requires an explicit account for destructive secret rotation", () => {
    const { tools } = setupTools();
    const schema = toolSchema(tools, "regenerate_webhook_secret");
    const annotations = tools.get("regenerate_webhook_secret")?.config.annotations;

    expect(schema.safeParse({ webhook_id: 3 }).success).toBe(false);
    expect(schema.safeParse({ account_id: 7, webhook_id: 3 }).success).toBe(true);
    expect(annotations?.destructiveHint).toBe(true);
    expect(annotations?.idempotentHint).toBeUndefined();
  });
});

describe("pipeline-webhooks tools — public automation webhook", () => {
  it("posts the payload object directly to the token route", async () => {
    const { tools, client } = setupTools();
    const schema = toolSchema(tools, "trigger_pipeline_automation_via_webhook");
    const payload = { order_id: "order-42", amount: 199.9 };

    expect(schema.safeParse({ token: "token-123", payload }).success).toBe(true);
    expect(
      schema.safeParse({ token: "token-123", payload: { value: "x".repeat(1024 * 1024) } }).success,
    ).toBe(false);

    await tools.get("trigger_pipeline_automation_via_webhook")?.handler({
      token: "token-123",
      payload,
    });

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/pipeline_automation_webhooks/token-123",
      payload,
    );
  });

  it("verifies the same token route as a read-only 204/404 probe", async () => {
    const { tools, client } = setupTools();

    expect(tools.get("verify_pipeline_automation_webhook")?.config.annotations?.readOnlyHint).toBe(
      true,
    );

    await tools.get("verify_pipeline_automation_webhook")?.handler({ token: "token-123" });

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/pipeline_automation_webhooks/token-123/verify",
    );
  });
});
