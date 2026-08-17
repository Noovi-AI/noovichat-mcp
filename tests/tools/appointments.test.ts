import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NooviChatClient } from "../../src/client.js";
import { register } from "../../src/tools/appointments.js";

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
    get: vi.fn(async () => ({ data: [] })),
    post: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
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

function parseInput(tool: RegisteredTool | undefined, value: Record<string, unknown>) {
  return z.object(tool?.config.inputSchema ?? {}).safeParse(value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appointments tools — registration and account scope", () => {
  it("registers only implemented appointment and catalog routes", () => {
    const { tools } = setup();

    expect([...tools.keys()].sort()).toEqual(
      [
        "bulk_appointment_action",
        "cancel_appointment",
        "complete_appointment",
        "confirm_appointment",
        "create_appointment",
        "create_partner",
        "create_professional",
        "create_service",
        "delete_partner",
        "delete_professional",
        "delete_service",
        "export_appointments_csv",
        "get_appointment",
        "get_appointment_availability",
        "get_appointment_availability_range",
        "get_appointments_metrics",
        "get_partner",
        "get_professional",
        "get_professional_availability",
        "get_service",
        "list_appointment_clients",
        "list_appointments",
        "list_available_professionals",
        "list_partners",
        "list_professionals",
        "list_services",
        "mark_appointment_no_show",
        "update_appointment",
        "update_partner",
        "update_professional",
        "update_service",
      ].sort(),
    );
    expect(tools.has("sync_appointment_to_google_calendar")).toBe(false);
  });

  it("uses the environment account for reads but requires it explicitly for destructive tools", async () => {
    vi.stubEnv("NOOVICHAT_ACCOUNT_ID", "17");
    const { tools, client } = setup();

    await tools.get("list_appointments")?.handler({});
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/17/appointments", {});

    for (const name of [
      "cancel_appointment",
      "complete_appointment",
      "mark_appointment_no_show",
      "bulk_appointment_action",
      "delete_service",
      "delete_professional",
      "delete_partner",
    ]) {
      const accountSchema = tools.get(name)?.config.inputSchema?.account_id;
      expect(accountSchema?.safeParse(undefined).success, name).toBe(false);
    }
  });
});

describe("appointments tools — exact appointment contract", () => {
  it("matches the list filters, fixed pagination, and scheduled status vocabulary", async () => {
    const { tools, client } = setup();
    const tool = tools.get("list_appointments");

    expect(inputKeys(tool)).toEqual(
      [
        "account_id",
        "contact_id",
        "conversation_display_id",
        "from",
        "page",
        "partner_id",
        "pipeline_card_id",
        "professional_id",
        "service_id",
        "status",
        "to",
      ].sort(),
    );
    expect(tool?.config.inputSchema?.status.safeParse("scheduled, confirmed").success).toBe(true);
    expect(tool?.config.inputSchema?.status.safeParse("pending").success).toBe(false);
    expect(tool?.config.inputSchema?.page.safeParse(10_001).success).toBe(true);
    expect(tool?.config.inputSchema?.page.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(tool?.config.inputSchema?.page.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(
      false,
    );
    expect(tool?.config.inputSchema?.from.safeParse("2026-08-01T09:00:00").success).toBe(false);
    expect(tool?.config.inputSchema?.from.safeParse("not-a-date").success).toBe(false);

    const params = {
      account_id: 7,
      status: "scheduled,confirmed",
      professional_id: 2,
      service_id: 3,
      partner_id: 4,
      contact_id: 5,
      pipeline_card_id: 6,
      conversation_display_id: 8,
      from: "2026-08-01T09:00:00-03:00",
      to: "2026-08-31T18:00:00-03:00",
      page: 2,
    };
    await tool?.handler(params);

    const { account_id: _accountId, ...query } = params;
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/appointments", query);
  });

  it("requires a professional on create and sends only real strong params", async () => {
    const { tools, client } = setup();
    const tool = tools.get("create_appointment");

    expect(inputKeys(tool)).toEqual(
      [
        "account_id",
        "contact_id",
        "conversation_display_id",
        "custom_attributes",
        "ends_at",
        "notes",
        "partner_id",
        "pipeline_card_id",
        "professional_id",
        "scheduled_at",
        "service_id",
      ].sort(),
    );
    expect(
      parseInput(tool, {
        account_id: 7,
        contact_id: 11,
        service_id: 13,
        scheduled_at: "2026-08-10T10:00:00-03:00",
      }).success,
    ).toBe(false);
    expect(tool?.config.inputSchema?.scheduled_at.safeParse("2026-08-10T10:00").success).toBe(true);
    expect(
      tool?.config.inputSchema?.scheduled_at.safeParse("2026-08-10T10:00:00-03:00").success,
    ).toBe(true);
    expect(tool?.config.inputSchema?.scheduled_at.safeParse("not-a-date").success).toBe(false);
    expect(
      parseInput(tool, {
        account_id: 7,
        contact_id: 11,
        professional_id: 12,
        service_id: 13,
        scheduled_at: "2026-08-10T10:00:00-03:00",
        partner_id: null,
        ends_at: null,
        notes: null,
        conversation_display_id: null,
        pipeline_card_id: null,
      }).success,
    ).toBe(true);
    expect(tool?.config.inputSchema?.conversation_display_id.safeParse(2_147_483_647).success).toBe(
      true,
    );
    expect(tool?.config.inputSchema?.conversation_display_id.safeParse(2_147_483_648).success).toBe(
      false,
    );

    const args = {
      account_id: 7,
      contact_id: 11,
      professional_id: 12,
      service_id: 13,
      partner_id: 14,
      scheduled_at: "2026-08-10T10:00:00-03:00",
      ends_at: "2026-08-10T11:00:00-03:00",
      notes: "Retorno",
      conversation_display_id: 15,
      pipeline_card_id: 16,
      custom_attributes: { source: "mcp" },
    };
    await tool?.handler(args);

    const { account_id: _accountId, ...appointment } = args;
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/appointments", {
      appointment,
    });
  });

  it("limits update to the four mutable fields accepted by Rails", async () => {
    const { tools, client } = setup();
    const tool = tools.get("update_appointment");

    expect(inputKeys(tool)).toEqual(
      [
        "account_id",
        "appointment_id",
        "custom_attributes",
        "notes",
        "partner_id",
        "scheduled_at",
      ].sort(),
    );
    expect(inputKeys(tool)).not.toContain("duration_minutes");
    expect(inputKeys(tool)).not.toContain("status");
    expect(inputKeys(tool)).not.toContain("professional_id");
    expect(inputKeys(tool)).not.toContain("service_id");
    expect(inputKeys(tool)).not.toContain("ends_at");

    await tool?.handler({
      account_id: 7,
      appointment_id: 42,
      scheduled_at: "2026-08-11T11:00:00-03:00",
      notes: null,
      partner_id: null,
      custom_attributes: { rescheduled_by: "mcp" },
    });

    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/appointments/42", {
      appointment: {
        scheduled_at: "2026-08-11T11:00:00-03:00",
        notes: null,
        partner_id: null,
        custom_attributes: { rescheduled_by: "mcp" },
      },
    });
  });

  it("describes the exact show projection without claiming materialized reminders", () => {
    const { tools } = setup();
    const description = tools.get("get_appointment")?.config.description;

    expect(description).toContain("exact appointment projection");
    expect(description).toContain("compact contact");
    expect(description).toContain("Materialized reminders are not included");
  });

  it("passes the cancellation reason as the top-level DELETE query parameter", async () => {
    const { tools, client } = setup();
    const tool = tools.get("cancel_appointment");

    expect(tool?.config.annotations?.destructiveHint).toBe(true);
    expect(inputKeys(tool)).toContain("reason");
    expect(inputKeys(tool)).not.toContain("cancellation_reason");

    await tool?.handler({ account_id: 7, appointment_id: 42, reason: "Cliente pediu" });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/accounts/7/appointments/42", {
      reason: "Cliente pediu",
    });
  });

  it.each([
    ["confirm_appointment", "/api/v1/accounts/7/appointments/42/confirm"],
    ["complete_appointment", "/api/v1/accounts/7/appointments/42/complete"],
    ["mark_appointment_no_show", "/api/v1/accounts/7/appointments/42/no_show"],
  ])("posts %s to its status transition route", async (name, path) => {
    const { tools, client } = setup();
    await tools.get(name)?.handler({ account_id: 7, appointment_id: 42 });
    expect(client.post).toHaveBeenCalledWith(path);
  });

  it("publishes the factual idempotent and destructive status-transition hints", () => {
    const { tools } = setup();
    expect(tools.get("confirm_appointment")?.config.annotations?.idempotentHint).toBe(true);
    expect(tools.get("complete_appointment")?.config.annotations?.idempotentHint).toBe(true);
    expect(tools.get("mark_appointment_no_show")?.config.annotations?.idempotentHint).toBe(true);
    expect(tools.get("complete_appointment")?.config.annotations?.destructiveHint).toBe(true);
    expect(tools.get("mark_appointment_no_show")?.config.annotations?.destructiveHint).toBe(true);
    expect(tools.get("confirm_appointment")?.config.annotations?.destructiveHint).toBeUndefined();
  });

  it("enforces the bounded unique ID contract and exact bulk action vocabulary", async () => {
    const { tools, client } = setup();
    const tool = tools.get("bulk_appointment_action");
    const ids = tool?.config.inputSchema?.ids;

    expect(tool?.config.inputSchema?.bulk_action.safeParse("confirm").success).toBe(true);
    expect(tool?.config.inputSchema?.bulk_action.safeParse("complete").success).toBe(false);
    expect(ids?.safeParse([]).success).toBe(false);
    expect(ids?.safeParse(Array.from({ length: 100 }, (_, index) => index + 1)).success).toBe(true);
    expect(ids?.safeParse(Array.from({ length: 101 }, (_, index) => index + 1)).success).toBe(
      false,
    );
    expect(ids?.safeParse([41, 41]).success).toBe(false);
    expect(ids?.safeParse([0]).success).toBe(false);
    expect(ids?.safeParse([1.5]).success).toBe(false);
    expect(ids?.safeParse(["41"]).success).toBe(false);
    expect(ids?.safeParse([Number.MAX_SAFE_INTEGER]).success).toBe(true);
    expect(ids?.safeParse([Number.MAX_SAFE_INTEGER + 1]).success).toBe(false);
    expect(tool?.config.inputSchema?.reason.safeParse(null).success).toBe(true);
    expect(tool?.config.description).toContain("200 {data:{action,count,succeeded,failed}}");
    expect(tool?.config.description).toContain("404 before any action");
    expect(tool?.config.description).toContain("malformed input returns 422");
    await tool?.handler({
      account_id: 7,
      bulk_action: "cancel",
      ids: [41, 42],
      reason: "Feriado",
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/appointments/bulk_action", {
      bulk_action: "cancel",
      ids: [41, 42],
      reason: "Feriado",
    });
  });

  it("exports every filter implemented by apply_filters without pagination", async () => {
    const { tools, client } = setup();
    const tool = tools.get("export_appointments_csv");

    expect(inputKeys(tool)).toEqual(
      [
        "account_id",
        "contact_id",
        "conversation_display_id",
        "from",
        "partner_id",
        "pipeline_card_id",
        "professional_id",
        "service_id",
        "status",
        "to",
      ].sort(),
    );
    await tool?.handler({ account_id: 7, status: "scheduled,no_show", service_id: 3 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/appointments/export.csv", {
      status: "scheduled,no_show",
      service_id: 3,
    });
  });

  it("keeps metrics to its real from/to query and wires both availability routes", async () => {
    const { tools, client } = setup();

    expect(inputKeys(tools.get("get_appointments_metrics"))).toEqual(["account_id", "from", "to"]);
    await tools.get("get_appointments_metrics")?.handler({
      account_id: 7,
      from: "2026-08-01T00:00:00-03:00",
      to: "2026-08-31T23:59:59-03:00",
    });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/appointments/metrics", {
      from: "2026-08-01T00:00:00-03:00",
      to: "2026-08-31T23:59:59-03:00",
    });

    const availability = tools.get("get_appointment_availability");
    expect(parseInput(availability, { account_id: 7, date: "2026-08-12" }).success).toBe(false);
    expect(availability?.config.inputSchema?.date.safeParse("2026-02-29").success).toBe(false);
    await availability?.handler({
      account_id: 7,
      professional_id: 2,
      date: "2026-08-12",
      service_id: 3,
    });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/appointments/availability", {
      professional_id: 2,
      date: "2026-08-12",
      service_id: 3,
    });

    const range = tools.get("get_appointment_availability_range");
    // O intervalo pede os dois extremos: sem `to`, a chamada cairia no
    // endpoint com um range aberto em vez de ser recusada aqui.
    expect(
      parseInput(range, { account_id: 7, professional_id: 2, from: "2026-08-12" }).success,
    ).toBe(false);
    expect(range?.config.inputSchema?.to.safeParse("2026-02-29").success).toBe(false);
    await range?.handler({
      account_id: 7,
      professional_id: 2,
      from: "2026-08-10",
      to: "2026-08-16",
      service_id: 3,
    });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/accounts/7/appointments/availability_range",
      { professional_id: 2, from: "2026-08-10", to: "2026-08-16", service_id: 3 },
    );

    await tools.get("list_available_professionals")?.handler({
      account_id: 7,
      scheduled_at: "2026-08-12T10:00:00-03:00",
      duration_minutes: 45,
    });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/accounts/7/appointments/available_professionals",
      { scheduled_at: "2026-08-12T10:00:00-03:00", duration_minutes: 45 },
    );
  });
});

describe("appointments tools — exact catalog contracts", () => {
  it.each([
    ["list_services", "/api/v1/accounts/7/services"],
    ["list_professionals", "/api/v1/accounts/7/professionals"],
  ])("calls non-paginated %s without fake query params", async (name, path) => {
    const { tools, client } = setup();
    expect(inputKeys(tools.get(name))).toEqual(["account_id"]);
    await tools.get(name)?.handler({ account_id: 7 });
    expect(client.get).toHaveBeenCalledWith(path);
  });

  it("lists only active partners unless asked otherwise", async () => {
    const { tools, client } = setup();
    expect(inputKeys(tools.get("list_partners"))).toEqual([
      "account_id",
      "include_inactive",
    ]);

    await tools.get("list_partners")?.handler({ account_id: 7 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/partners");
  });

  it("asks for the deactivated partners when told to", async () => {
    const { tools, client } = setup();

    // Sem este filtro um parceiro desativado fica inalcancavel, inclusive
    // para reativa-lo.
    await tools
      .get("list_partners")
      ?.handler({ account_id: 7, include_inactive: true });

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/accounts/7/partners?include_inactive=true",
    );
  });

  it("accepts a partner type the account invented", () => {
    const { tools } = setup();

    // Como enum, o zod recusaria o tipo criado pela conta antes da requisicao.
    const schema = tools.get("create_partner")?.config?.inputSchema?.kind;
    expect(schema?.safeParse("Particular Premium").success).toBe(true);
    expect(schema?.safeParse("x".repeat(41)).success).toBe(false);
  });

  it("aggregates the client directory over the whole history", async () => {
    const { tools, client } = setup();
    expect(inputKeys(tools.get("list_appointment_clients"))).toEqual([
      "account_id",
      "page",
      "q",
      "sort",
    ]);

    await tools
      .get("list_appointment_clients")
      ?.handler({ account_id: 7, q: "maria", sort: "frequency" });

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/accounts/7/appointments/clients",
      { q: "maria", sort: "frequency" },
    );
  });

  it("uses the real service fields and forwards reminder templates", async () => {
    const { tools, client } = setup();
    const tool = tools.get("create_service");

    expect(inputKeys(tool)).toContain("default_price_cents");
    expect(inputKeys(tool)).toContain("online_available");
    expect(inputKeys(tool)).toContain("reminder_templates");
    expect(inputKeys(tool)).not.toContain("price_cents");
    expect(parseInput(tool, { account_id: 7, name: "Consulta" }).success).toBe(false);

    const args = {
      account_id: 7,
      name: "Consulta",
      description: "Consulta inicial",
      duration_minutes: 60,
      default_price_cents: 25_000,
      currency: "BRL",
      color: "#10B981",
      online_available: true,
      active: true,
      custom_attributes: { category: "clinic" },
      reminder_templates: [
        {
          label: "1 hora antes",
          hours_before: 1,
          body_template: "Lembrete de {{servico}}",
        },
      ],
    };
    const parsed = parseInput(tool, args);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    await tool?.handler(parsed.data);

    const { account_id: _accountId, ...service } = parsed.data;
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/services", {
      service: {
        ...service,
        reminder_templates: [
          {
            label: "1 hora antes",
            days_before: 0,
            hours_before: 1,
            minutes_before: 0,
            body_template: "Lembrete de {{servico}}",
            send_via: "whatsapp",
          },
        ],
      },
    });
    expect(
      tool?.config.inputSchema?.reminder_templates.safeParse([
        { minutes_before: 30, body_template: "Lembrete", send_via: "email" },
      ]).success,
    ).toBe(false);
  });

  it.each(["create_service", "update_service"])(
    "%s rejects the removed Meta template identifier",
    (toolName) => {
      const { tools } = setup();
      const reminderTemplatesSchema = tools.get(toolName)?.config.inputSchema?.reminder_templates;

      expect(
        reminderTemplatesSchema?.safeParse([
          {
            minutes_before: 30,
            body_template: "Lembrete",
            whatsapp_template_id: 123,
          },
        ]).success,
      ).toBe(false);
    },
  );

  it.each(["create_service", "update_service"])(
    "%s enforces the reminder offset, body, nullable label, and placeholder contract",
    (toolName) => {
      const { tools } = setup();
      const reminderTemplatesSchema = tools.get(toolName)?.config.inputSchema?.reminder_templates;
      const reminder = (overrides: Record<string, unknown>) => [
        { minutes_before: 1, body_template: "Lembrete", ...overrides },
      ];

      expect(reminderTemplatesSchema?.safeParse(reminder({ label: null })).success).toBe(true);
      expect(
        reminderTemplatesSchema?.safeParse(
          reminder({ days_before: 1_491_308, minutes_before: 127 }),
        ).success,
      ).toBe(true);
      expect(
        reminderTemplatesSchema?.safeParse(
          reminder({ hours_before: 35_791_394, minutes_before: 7 }),
        ).success,
      ).toBe(true);
      expect(
        reminderTemplatesSchema?.safeParse(reminder({ minutes_before: 2_147_483_647 })).success,
      ).toBe(true);

      expect(reminderTemplatesSchema?.safeParse(reminder({ days_before: 1_491_309 })).success).toBe(
        false,
      );
      expect(
        reminderTemplatesSchema?.safeParse(reminder({ hours_before: 35_791_395 })).success,
      ).toBe(false);
      expect(
        reminderTemplatesSchema?.safeParse(reminder({ minutes_before: 2_147_483_648 })).success,
      ).toBe(false);
      expect(
        reminderTemplatesSchema?.safeParse(
          reminder({ days_before: 1_491_308, minutes_before: 128 }),
        ).success,
      ).toBe(false);
      expect(
        reminderTemplatesSchema?.safeParse(
          reminder({ hours_before: 35_791_394, minutes_before: 8 }),
        ).success,
      ).toBe(false);
      expect(reminderTemplatesSchema?.safeParse(reminder({ body_template: "" })).success).toBe(
        false,
      );
      expect(reminderTemplatesSchema?.safeParse(reminder({ body_template: "   " })).success).toBe(
        false,
      );
      expect(
        reminderTemplatesSchema?.safeParse(reminder({ body_template: "x".repeat(4_096) })).success,
      ).toBe(true);
      expect(
        reminderTemplatesSchema?.safeParse(reminder({ body_template: "x".repeat(4_097) })).success,
      ).toBe(false);
      expect(
        reminderTemplatesSchema?.safeParse(reminder({ body_template: "😀".repeat(4_096) })).success,
      ).toBe(true);
      expect(
        reminderTemplatesSchema?.safeParse(reminder({ body_template: "😀".repeat(4_097) })).success,
      ).toBe(false);
      expect(reminderTemplatesSchema?.description).toContain("4,096 Unicode characters");
      expect(reminderTemplatesSchema?.description).toContain("{{valor}}");
    },
  );

  it("uses service_ids for professionals and validates working hours", async () => {
    const { tools, client } = setup();
    const tool = tools.get("create_professional");

    expect(inputKeys(tool)).toContain("service_ids");
    expect(inputKeys(tool)).toContain("buffer_minutes");
    expect(inputKeys(tool)).not.toContain("user_id");
    expect(inputKeys(tool)).not.toContain("agent_id");
    expect(inputKeys(tool)).not.toContain("partner_id");
    expect(
      tool?.config.inputSchema?.working_hours.safeParse({
        mon: [{ start: "99:99", end: "17:00" }],
      }).success,
    ).toBe(false);
    expect(
      tool?.config.inputSchema?.working_hours.safeParse({
        mon: [{ start: "17:00", end: "08:00" }],
      }).success,
    ).toBe(false);

    const args = {
      account_id: 7,
      name: "Dra. Ana",
      specialty: "Odontologia",
      service_ids: [3, 4],
      buffer_minutes: 10,
      working_hours: { mon: [{ start: "08:00", end: "17:00" }] },
    };
    expect(parseInput(tool, args).success).toBe(true);
    await tool?.handler(args);

    const { account_id: _accountId, ...professional } = args;
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/professionals", {
      professional,
    });
  });

  it("uses kind/settings for partners and excludes fabricated contact fields", async () => {
    const { tools, client } = setup();
    const tool = tools.get("create_partner");

    expect(inputKeys(tool)).toEqual(["account_id", "active", "kind", "name", "settings"]);
    expect(inputKeys(tool)).not.toContain("address");
    expect(inputKeys(tool)).not.toContain("phone_number");
    expect(inputKeys(tool)).not.toContain("email");
    expect(inputKeys(tool)).not.toContain("custom_attributes");

    await tool?.handler({
      account_id: 7,
      name: "Unimed",
      kind: "convenio",
      settings: { authorization_required: true },
    });
    expect(client.post).toHaveBeenCalledWith("/api/v1/accounts/7/partners", {
      partner: {
        name: "Unimed",
        kind: "convenio",
        settings: { authorization_required: true },
      },
    });
  });

  it("wires catalog show, update, availability, and soft-delete routes", async () => {
    const { tools, client } = setup();

    await tools.get("get_service")?.handler({ account_id: 7, service_id: 3 });
    await tools.get("get_professional")?.handler({ account_id: 7, professional_id: 4 });
    await tools.get("get_partner")?.handler({ account_id: 7, partner_id: 5 });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/services/3");
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/professionals/4");
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/partners/5");

    await tools.get("update_service")?.handler({
      account_id: 7,
      service_id: 3,
      default_price_cents: 30_000,
    });
    await tools.get("update_professional")?.handler({
      account_id: 7,
      professional_id: 4,
      service_ids: [],
    });
    await tools.get("update_partner")?.handler({
      account_id: 7,
      partner_id: 5,
      active: false,
    });
    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/services/3", {
      service: { default_price_cents: 30_000 },
    });
    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/professionals/4", {
      professional: { service_ids: [] },
    });
    expect(client.patch).toHaveBeenCalledWith("/api/v1/accounts/7/partners/5", {
      partner: { active: false },
    });

    const availability = tools.get("get_professional_availability");
    expect(inputKeys(availability)).toEqual(
      ["account_id", "date", "duration_minutes", "professional_id", "service_id"].sort(),
    );
    await availability?.handler({
      account_id: 7,
      professional_id: 4,
      date: "2026-08-12",
      duration_minutes: 30,
    });
    expect(client.get).toHaveBeenCalledWith("/api/v1/accounts/7/professionals/4/availability", {
      date: "2026-08-12",
      duration_minutes: 30,
    });

    await tools.get("delete_service")?.handler({ account_id: 7, service_id: 3 });
    await tools.get("delete_professional")?.handler({ account_id: 7, professional_id: 4 });
    await tools.get("delete_partner")?.handler({ account_id: 7, partner_id: 5 });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/accounts/7/services/3");
    expect(client.delete).toHaveBeenCalledWith("/api/v1/accounts/7/professionals/4");
    expect(client.delete).toHaveBeenCalledWith("/api/v1/accounts/7/partners/5");
  });
});
