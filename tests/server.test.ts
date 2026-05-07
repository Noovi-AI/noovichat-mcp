import { describe, expect, it } from "vitest";
import { NooviChatClient } from "../src/client.js";
import { createServer } from "../src/server.js";

describe("createServer", () => {
  it("instantiates an McpServer with a NooviChatClient", () => {
    const client = new NooviChatClient({
      baseUrl: "https://example.com",
      apiToken: "test-token",
    });
    const server = createServer(client);
    expect(server).toBeDefined();
  });

  it("registers all expected tool modules without throwing", () => {
    // Smoke: registration shouldn't throw on instantiation.
    const client = new NooviChatClient({
      baseUrl: "https://example.com",
      apiToken: "test-token",
    });
    expect(() => createServer(client)).not.toThrow();
  });

  it("exposes a non-zero number of tools", () => {
    const client = new NooviChatClient({
      baseUrl: "https://example.com",
      apiToken: "test-token",
    });
    const server = createServer(client);
    // Access the SDK's internal registry via a controlled cast — kept narrow
    // to catch regressions where modules silently fail to register.
    // biome-ignore lint/suspicious/noExplicitAny: SDK does not expose tool count publicly.
    const tools = (server as any)._registeredTools as Record<string, unknown> | undefined;
    expect(tools).toBeDefined();
    expect(Object.keys(tools ?? {}).length).toBeGreaterThan(50);
  });
});
