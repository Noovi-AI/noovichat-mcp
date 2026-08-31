import { describe, expect, it, vi } from "vitest";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/profile.js";

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
    get: vi.fn(async () => ({ id: 9, accounts: [{ id: 1, name: "Acme" }] })),
    post: vi.fn(async () => ({ ok: true })),
    patch: vi.fn(async () => ({ ok: true })),
    put: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => ({ ok: true })),
  };
}

describe("profile tools", () => {
  it("registers get_profile as read-only with no account_id", () => {
    const { server, tools } = makeStubServer();
    register(server as never, makeMockClient() as unknown as NooviChatClient);

    expect(tools.has("get_profile")).toBe(true);
    expect(tools.get("get_profile")?.config.annotations?.readOnlyHint).toBe(true);
    expect(tools.get("get_profile")?.config.inputSchema).toEqual({});
  });

  it("GETs /api/v1/profile", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools.get("get_profile")?.handler({});
    expect(client.get).toHaveBeenCalledWith("/api/v1/profile");
  });
});
