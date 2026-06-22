import { describe, expect, it, vi } from "vitest";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/broadcasts.js";

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

describe("broadcasts tools — retry_failed", () => {
  it("registers retry_failed_broadcast as idempotent", () => {
    const { server, tools } = makeStubServer();
    register(server as never, makeMockClient() as unknown as NooviChatClient);

    expect(tools.has("retry_failed_broadcast")).toBe(true);
    expect(tools.get("retry_failed_broadcast")?.config.annotations?.idempotentHint).toBe(true);
  });

  it("posts to the retry_failed route", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools.get("retry_failed_broadcast")?.handler({ account_id: 7, broadcast_id: 42 });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/broadcasts/42/retry_failed");
  });
});
