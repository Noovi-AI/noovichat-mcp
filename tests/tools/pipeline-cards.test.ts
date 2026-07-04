import { describe, expect, it, vi } from "vitest";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/pipeline-cards.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: { annotations?: Record<string, unknown>; inputSchema?: Record<string, unknown> };
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
