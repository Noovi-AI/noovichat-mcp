import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/follow-ups.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: { annotations?: Record<string, unknown>; inputSchema?: z.ZodRawShape };
  handler: Handler;
}

function setup() {
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

function schemaOf(tools: Map<string, RegisteredTool>, name: string) {
  return z.object(tools.get(name)?.config.inputSchema as z.ZodRawShape);
}

async function call(name: string, input: Record<string, unknown>) {
  const { tools, client } = setup();
  const parsed = schemaOf(tools, name).safeParse(input);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  await tools.get(name)?.handler(parsed.success ? parsed.data : input);
  return { tools, client };
}

// Contract audit 2026-09-27 (Chatwoot FU-35). Each case mirrors what the
// Chatwoot controller actually reads — the previous tool sent fields the API
// dropped in silence.
describe("follow-ups — bodies match the Chatwoot controllers", () => {
  it("create_followup wraps the body in `follow_up` with the real field names", async () => {
    const { client } = await call("create_followup", {
      account_id: 7,
      conversation_id: 42,
      scheduled_at: 1_900_000_000,
      follow_up_template_id: 3,
      title: "Retorno",
      inbox_id: 2,
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/conversations/42/follow-ups", {
      follow_up: {
        scheduled_at: 1_900_000_000,
        follow_up_template_id: 3,
        title: "Retorno",
        inbox_id: 2,
      },
    });
  });

  it("update_followup wraps the body and accepts an ISO scheduled_at", async () => {
    const { client } = await call("update_followup", {
      account_id: 7,
      conversation_id: 42,
      followup_id: 9,
      scheduled_at: "2030-01-10T14:00:00",
    });
    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/conversations/42/follow-ups/9", {
      follow_up: { scheduled_at: "2030-01-10T14:00:00" },
    });
  });

  it("create_followup no longer offers fields the API ignores", () => {
    const { tools } = setup();
    const shape = tools.get("create_followup")?.config.inputSchema ?? {};
    for (const gone of [
      "template_id",
      "template_variables",
      "pipeline_card_id",
      "attachment_ids",
    ]) {
      expect(Object.keys(shape)).not.toContain(gone);
    }
  });

  it("status filters only offer statuses that exist", () => {
    const { tools } = setup();
    const list = schemaOf(tools, "list_followups");
    expect(list.safeParse({ status: "pending" }).success).toBe(true);
    expect(list.safeParse({ status: "scheduled" }).success).toBe(false);
    expect(list.safeParse({ status: "sending" }).success).toBe(false);
  });

  it("delete_followup hits DELETE, is destructive and needs an explicit account", async () => {
    const { tools, client } = await call("delete_followup", {
      account_id: 7,
      conversation_id: 42,
      followup_id: 9,
    });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/accounts/7/conversations/42/follow-ups/9");
    expect(tools.get("delete_followup")?.config.annotations?.destructiveHint).toBe(true);
    expect(
      schemaOf(tools, "delete_followup").safeParse({ conversation_id: 42, followup_id: 9 }).success,
    ).toBe(false);
  });

  it("count_conversation_followups sends no ignored filter", async () => {
    const { client } = await call("count_conversation_followups", {
      account_id: 7,
      conversation_id: 42,
    });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/conversations/42/follow-ups/count");
  });

  it("templates: create/update use the `follow_up_template` envelope", async () => {
    const created = await call("create_followup_template", {
      account_id: 7,
      name: "Oi",
      content: "Olá {{contact_name}}",
    });
    expect(created.client.post).toHaveBeenCalledWith("/api/v1/accounts/7/follow-up-templates", {
      follow_up_template: { name: "Oi", content: "Olá {{contact_name}}" },
    });

    const updated = await call("update_followup_template", {
      account_id: 7,
      template_id: 3,
      active: false,
    });
    expect(updated.client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/follow-up-templates/3", {
      follow_up_template: { active: false },
    });
  });

  it("preview sends `context`, the key the controller reads", async () => {
    const { client } = await call("preview_followup_template", {
      account_id: 7,
      template_id: 3,
      context: { contact_name: "Ana" },
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/follow-up-templates/3/preview", {
      context: { contact_name: "Ana" },
    });
  });

  it("unpaginated lists send no page params", async () => {
    const templates = await call("list_followup_templates", { account_id: 7 });
    expect(templates.client.get).toHaveBeenCalledWith("/api/v1/accounts/7/follow-up-templates");
    const automations = await call("list_followup_automations", { account_id: 7 });
    expect(automations.client.get).toHaveBeenCalledWith("/api/v1/accounts/7/follow-up-automations");
  });
});

describe("follow-ups — reports", () => {
  it("sends since/until and the real filters", async () => {
    const { client } = await call("get_followups_report", {
      account_id: 7,
      view: "summary",
      since: 1_700_000_000,
      until: 1_700_600_000,
      status: "failed",
      source: "pipeline",
    });
    expect(client.get).toHaveBeenCalledWith("/api/v2/accounts/7/reports/follow-ups/summary", {
      since: 1_700_000_000,
      until: 1_700_600_000,
      status: "failed",
      source: "pipeline",
    });
  });

  it("export asks for JSON explicitly", async () => {
    const { client } = await call("get_followups_report", { account_id: 7, view: "export" });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v2/accounts/7/reports/follow-ups/export.json",
      {},
    );
  });

  it("the old from/to keys are no longer accepted as report filters", () => {
    const { tools } = setup();
    const shape = tools.get("get_followups_report")?.config.inputSchema ?? {};
    expect(Object.keys(shape)).not.toContain("from");
    expect(Object.keys(shape)).not.toContain("to");
  });
});
