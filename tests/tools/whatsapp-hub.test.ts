import { describe, expect, it, vi } from "vitest";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/whatsapp-hub.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: { annotations?: Record<string, unknown>; inputSchema?: Record<string, unknown> };
  handler: Handler;
}

/**
 * Minimal stub of the MCP server that captures registered tools so we can
 * assert on names, schemas, annotations and the URL each handler builds.
 */
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

const EXPECTED_TOOLS = [
  "noovi_connect_list_sessions",
  "noovi_connect_list_groups",
  "noovi_connect_list_channels",
  "noovi_connect_hub_report",
  "noovi_connect_create_group",
  "noovi_connect_group_participants",
  "noovi_connect_add_participants",
];

describe("whatsapp-hub tools", () => {
  it("registers every WhatsApp Hub tool", () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    for (const name of EXPECTED_TOOLS) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("marks read tools as readOnly", () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    for (const name of [
      "noovi_connect_list_sessions",
      "noovi_connect_list_groups",
      "noovi_connect_list_channels",
      "noovi_connect_hub_report",
      "noovi_connect_group_participants",
    ]) {
      expect(tools.get(name)?.config.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("list_sessions hits the index route without inbox", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools.get("noovi_connect_list_sessions")?.handler({ account_id: 7 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect");
  });

  it("list_groups / list_channels / hub_report build the inbox-scoped routes", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools.get("noovi_connect_list_groups")?.handler({ account_id: 7, inbox_id: 3 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/groups");

    await tools.get("noovi_connect_list_channels")?.handler({ account_id: 7, inbox_id: 3 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/newsletters");

    await tools.get("noovi_connect_hub_report")?.handler({ account_id: 7, inbox_id: 3 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/hub_report");
  });

  it("group_participants passes group_jid as a query param", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools
      .get("noovi_connect_group_participants")
      ?.handler({ account_id: 7, inbox_id: 3, group_jid: "123@g.us" });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/accounts/7/noovi_connect/3/group_participants",
      { group_jid: "123@g.us" },
    );
  });

  it("create_group posts title + participants (no account_id/inbox_id in body)", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools.get("noovi_connect_create_group")?.handler({
      account_id: 7,
      inbox_id: 3,
      title: "Squad",
      participants: ["5511999999999"],
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/create_group", {
      title: "Squad",
      participants: ["5511999999999"],
    });
  });

  it("add_participants posts group_jid + phones (no account_id/inbox_id in body)", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools.get("noovi_connect_add_participants")?.handler({
      account_id: 7,
      inbox_id: 3,
      group_jid: "123@g.us",
      phones: ["5511999999999"],
    });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/noovi_connect/3/add_participants",
      { group_jid: "123@g.us", phones: ["5511999999999"] },
    );
  });
});
