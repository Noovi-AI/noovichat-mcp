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
  "noovi_connect_group_invite_link",
  "noovi_connect_add_participants",
  "noovi_connect_remove_participants",
  "noovi_connect_promote_participants",
  "noovi_connect_demote_participants",
  "noovi_connect_set_group_name",
  "noovi_connect_set_group_topic",
  "noovi_connect_set_group_photo",
  "noovi_connect_set_group_locked",
  "noovi_connect_set_group_announce",
  "noovi_connect_leave_group",
  "noovi_connect_unfollow_newsletter",
  "noovi_connect_send_poll",
  "noovi_connect_send_location",
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

  it("group_invite_link passes group_jid as a query param (GET)", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools
      .get("noovi_connect_group_invite_link")
      ?.handler({ account_id: 7, inbox_id: 3, group_jid: "123@g.us" });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/accounts/7/noovi_connect/3/group_invite_link",
      { group_jid: "123@g.us" },
    );
  });

  it("remove/promote/demote participants post group_jid + phones to their routes", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    for (const action of ["remove_participants", "promote_participants", "demote_participants"]) {
      await tools.get(`noovi_connect_${action}`)?.handler({
        account_id: 7,
        inbox_id: 3,
        group_jid: "123@g.us",
        phones: ["5511999999999"],
      });
      expect(client.post).toHaveBeenCalledWith(`/api/v1/accounts/7/noovi_connect/3/${action}`, {
        group_jid: "123@g.us",
        phones: ["5511999999999"],
      });
    }
  });

  it("set_group_name / set_group_locked / set_group_announce post their bodies", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools
      .get("noovi_connect_set_group_name")
      ?.handler({ account_id: 7, inbox_id: 3, group_jid: "123@g.us", name: "Squad" });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/set_group_name", {
      group_jid: "123@g.us",
      name: "Squad",
    });

    await tools
      .get("noovi_connect_set_group_locked")
      ?.handler({ account_id: 7, inbox_id: 3, group_jid: "123@g.us", locked: true });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/noovi_connect/3/set_group_locked",
      { group_jid: "123@g.us", locked: true },
    );

    await tools
      .get("noovi_connect_set_group_announce")
      ?.handler({ account_id: 7, inbox_id: 3, group_jid: "123@g.us", announce: false });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/noovi_connect/3/set_group_announce",
      { group_jid: "123@g.us", announce: false },
    );
  });

  it("leave_group posts only group_jid", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools
      .get("noovi_connect_leave_group")
      ?.handler({ account_id: 7, inbox_id: 3, group_jid: "123@g.us" });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/leave_group", {
      group_jid: "123@g.us",
    });
  });

  it("unfollow_newsletter posts the newsletter_id", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools
      .get("noovi_connect_unfollow_newsletter")
      ?.handler({ account_id: 7, inbox_id: 3, newsletter_id: "999@newsletter" });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/noovi_connect/3/unfollow_newsletter",
      { newsletter_id: "999@newsletter" },
    );
  });

  it("send_poll / send_location post their bodies (no account_id/inbox_id)", async () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    await tools.get("noovi_connect_send_poll")?.handler({
      account_id: 7,
      inbox_id: 3,
      phone: "5511999999999",
      question: "Pizza?",
      options: ["Sim", "Não"],
      max_answer: 1,
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/send_poll", {
      phone: "5511999999999",
      question: "Pizza?",
      options: ["Sim", "Não"],
      max_answer: 1,
    });

    await tools.get("noovi_connect_send_location")?.handler({
      account_id: 7,
      inbox_id: 3,
      phone: "5511999999999",
      latitude: -23.5,
      longitude: -46.6,
      title: "Escritório",
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/noovi_connect/3/send_location", {
      phone: "5511999999999",
      latitude: -23.5,
      longitude: -46.6,
      title: "Escritório",
    });
  });

  it("marks mutating group tools with the right annotations", () => {
    const { server, tools } = makeStubServer();
    const client = makeMockClient();
    register(server as never, client as unknown as NooviChatClient);

    for (const name of [
      "noovi_connect_remove_participants",
      "noovi_connect_leave_group",
      "noovi_connect_unfollow_newsletter",
    ]) {
      expect(tools.get(name)?.config.annotations?.destructiveHint).toBe(true);
    }
    expect(tools.get("noovi_connect_group_invite_link")?.config.annotations?.readOnlyHint).toBe(
      true,
    );
  });
});
