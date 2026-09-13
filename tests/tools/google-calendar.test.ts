import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/google-calendar.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  config: {
    annotations?: Record<string, unknown>;
    description?: string;
    inputSchema?: Record<string, z.ZodTypeAny>;
  };
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
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({ success: true })),
    patch: vi.fn(async () => ({ success: true })),
    put: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({ success: true })),
  };
}

function setup() {
  const { server, tools } = makeStubServer();
  const client = makeMockClient();
  register(server as never, client as unknown as NooviChatClient);
  return { tools, client };
}

function inputKeys(tool: RegisteredTool | undefined): string[] {
  return Object.keys(tool?.config.inputSchema ?? {}).sort();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// NOOVI (achado 2026-09-12, corrigido 2026-09-13): a versão anterior deste
// arquivo descrevia entity_type=appointment/pipeline_card, appointment_id,
// calendar_id e external_event_id — nenhum desses é lido pela API real.
// set_pipeline_card (google_calendar_controller.rb) exige pipeline_card_id
// em toda ação de escrita; sem ele, 404 "Pipeline card not found" antes de
// qualquer lógica rodar. Estes testes travam o contrato real, não o
// imaginado — se alguém reintroduzir entity_type/appointment_id/calendar_id/
// external_event_id no schema, o teste de "não existe mais" falha.
describe("google-calendar tools — pipeline cards only, never appointments", () => {
  it("registers exactly the 8 tools backed by real Chatwoot routes", () => {
    const { tools } = setup();

    expect([...tools.keys()].sort()).toEqual(
      [
        "bulk_sync_google_calendar",
        "get_google_calendar_circuit_status",
        "get_google_calendar_sync_status",
        "remove_from_google_calendar",
        "reset_google_calendar_circuit",
        "sync_from_google_calendar",
        "sync_to_google_calendar",
        "toggle_google_calendar_sync",
      ].sort(),
    );
  });

  it("requires pipeline_card_id on every write action and never offers entity_type/appointment_id/calendar_id/external_event_id", () => {
    const { tools } = setup();

    for (const name of [
      "sync_to_google_calendar",
      "sync_from_google_calendar",
      "remove_from_google_calendar",
      "toggle_google_calendar_sync",
    ]) {
      const keys = inputKeys(tools.get(name));
      expect(keys, name).toContain("pipeline_card_id");
      expect(keys, name).not.toContain("entity_type");
      expect(keys, name).not.toContain("appointment_id");
      expect(keys, name).not.toContain("calendar_id");
      expect(keys, name).not.toContain("external_event_id");
    }

    expect(inputKeys(tools.get("bulk_sync_google_calendar"))).not.toContain("entity_type");
  });

  it("sends only pipeline_card_id to sync_to_google", async () => {
    const { tools, client } = setup();
    await tools.get("sync_to_google_calendar")?.handler({ account_id: 7, pipeline_card_id: 42 });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/google_calendar/sync_to_google", {
      pipeline_card_id: 42,
    });
  });

  it("requires google_event_id and sends it with pipeline_card_id to sync_from_google (one event, one card)", async () => {
    const { tools, client } = setup();
    const tool = tools.get("sync_from_google_calendar");

    expect(inputKeys(tool)).toContain("google_event_id");
    expect(inputKeys(tool)).not.toContain("from");
    expect(inputKeys(tool)).not.toContain("to");

    await tool?.handler({ account_id: 7, pipeline_card_id: 42, google_event_id: "evt_123" });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/accounts/7/google_calendar/sync_from_google",
      {
        pipeline_card_id: 42,
        google_event_id: "evt_123",
      },
    );
  });

  it("sends pipeline_card_id as the DELETE query parameter for remove_from_google", async () => {
    const { tools, client } = setup();
    await tools
      .get("remove_from_google_calendar")
      ?.handler({ account_id: 7, pipeline_card_id: 42 });
    expect(client.delete).toHaveBeenCalledWith(
      "/api/v1/accounts/7/google_calendar/remove_from_google",
      { pipeline_card_id: 42 },
    );
  });

  it("scopes toggle_sync to one pipeline_card_id, not the account", async () => {
    const { tools, client } = setup();
    await tools
      .get("toggle_google_calendar_sync")
      ?.handler({ account_id: 7, pipeline_card_id: 42, enabled: false, remove_from_google: true });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/google_calendar/toggle_sync", {
      pipeline_card_id: 42,
      enabled: false,
      remove_from_google: true,
    });
  });

  it("uses sync_action (not the reserved 'action') and pipeline_ids (pipeline/board IDs, not card IDs) for bulk_sync", async () => {
    const { tools, client } = setup();
    const tool = tools.get("bulk_sync_google_calendar");

    expect(inputKeys(tool)).toEqual(["account_id", "pipeline_ids", "sync_action"].sort());
    expect(inputKeys(tool)).not.toContain("ids");

    await tool?.handler({ account_id: 7, sync_action: "sync_to_google", pipeline_ids: [1, 2] });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/google_calendar/bulk_sync", {
      sync_action: "sync_to_google",
      pipeline_ids: [1, 2],
    });
  });

  it("restricts sync_action to the three values the controller's case statement understands", () => {
    const { tools } = setup();
    const schema = z.object(tools.get("bulk_sync_google_calendar")?.config.inputSchema ?? {});

    expect(schema.safeParse({ sync_action: "enable" }).success).toBe(true);
    expect(schema.safeParse({ sync_action: "disable" }).success).toBe(true);
    expect(schema.safeParse({ sync_action: "sync_to_google" }).success).toBe(true);
    expect(schema.safeParse({ sync_action: "delete" }).success).toBe(false);
  });

  it("wires the two read-only status routes with no required input beyond account_id", async () => {
    const { tools, client } = setup();

    expect(tools.get("get_google_calendar_sync_status")?.config.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.get("get_google_calendar_circuit_status")?.config.annotations?.readOnlyHint).toBe(
      true,
    );

    await tools.get("get_google_calendar_sync_status")?.handler({ account_id: 7 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/google_calendar/sync_status");

    await tools.get("get_google_calendar_circuit_status")?.handler({ account_id: 7 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/google_calendar/circuit_status");
  });

  it("requires an explicit account_id for the admin-only circuit reset", async () => {
    const { tools, client } = setup();
    const tool = tools.get("reset_google_calendar_circuit");

    await tool?.handler({ account_id: 7 });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/google_calendar/circuit_reset");

    const schema = z.object(tool?.config.inputSchema ?? {});
    expect(schema.shape.account_id.isOptional()).toBe(false);
  });
});
