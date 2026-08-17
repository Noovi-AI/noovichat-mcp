/**
 * Atendimentos (appointments) and their supporting catalogs.
 *
 * Canonical Rails routes:
 *   /api/v1/accounts/:account_id/appointments
 *   /api/v1/accounts/:account_id/professionals
 *   /api/v1/accounts/:account_id/services
 *   /api/v1/accounts/:account_id/partners
 *
 * These controllers render JSON directly. Appointment list responses use
 * `{ data, meta }`; the remaining JSON responses use `{ data }`. Delete
 * endpoints return 204 and are converted by NooviChatClient to
 * `{ success: true }`.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  customAttributes,
  optionalAccountId,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const databaseId = z.number().int().positive().safe();
const appointmentId = databaseId.describe("Appointment ID");
const contactId = databaseId.describe("Contact ID");
const professionalId = databaseId.describe("Professional ID");
const serviceId = databaseId.describe("Service ID");
const partnerId = databaseId.describe("Partner ID");
const pipelineCardId = databaseId.describe("Pipeline card ID");
const conversationDisplayId = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647)
  .describe("Conversation display ID (per-account 32-bit sequence)");

const appointmentStatus = z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]);

const appointmentStatusFilter = z
  .string()
  .regex(
    /^\s*(scheduled|confirmed|completed|cancelled|no_show)\s*(,\s*(scheduled|confirmed|completed|cancelled|no_show)\s*)*$/,
    "Use one or more comma-separated appointment statuses",
  )
  .describe(`Comma-separated appointment statuses: ${appointmentStatus.options.join(", ")}`);

const localDateTime = z
  .string()
  .datetime({ offset: true, local: true })
  .describe(
    "ISO 8601 datetime. A value without an offset is interpreted in the account reporting timezone.",
  );

const absoluteDateTime = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 datetime with Z or an explicit UTC offset");

const calendarDate = z.string().date().describe("Calendar date in YYYY-MM-DD format");

const durationMinutes = z.number().int().positive().describe("Duration in minutes");

const appointmentPage = z
  .number()
  .int()
  .positive()
  .safe()
  .optional()
  .describe("Positive safe-integer page number; each page contains 50 appointments");

const hourMinute = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid 24-hour time in HH:MM format");

const workingHourWindow = z
  .object({
    start: hourMinute,
    end: hourMinute,
  })
  .strict()
  .refine((window) => window.start < window.end, {
    message: "Working-hour window start must be before end",
    path: ["end"],
  });

const workingHours = z
  .object({
    mon: z.array(workingHourWindow).optional(),
    tue: z.array(workingHourWindow).optional(),
    wed: z.array(workingHourWindow).optional(),
    thu: z.array(workingHourWindow).optional(),
    fri: z.array(workingHourWindow).optional(),
    sat: z.array(workingHourWindow).optional(),
    sun: z.array(workingHourWindow).optional(),
  })
  .strict()
  .describe("Working-hour windows keyed by mon, tue, wed, thu, fri, sat, and sun");

const maximumReminderOffsetMinutes = 2_147_483_647;
const reminderDaysBefore = z.number().int().nonnegative().max(1_491_308).default(0);
const reminderHoursBefore = z.number().int().nonnegative().max(35_791_394).default(0);
const reminderMinutesBefore = z
  .number()
  .int()
  .nonnegative()
  .max(maximumReminderOffsetMinutes)
  .default(0);
const maximumReminderBodyCharacters = 4_096;
const reminderBodyFitsCharacterLimit = (body: string) => {
  let characters = 0;
  for (const _character of body) {
    characters += 1;
    if (characters > maximumReminderBodyCharacters) return false;
  }
  return true;
};
const reminderBodyTemplate = z
  .string()
  .min(1)
  .refine(
    reminderBodyFitsCharacterLimit,
    `Reminder body must contain at most ${maximumReminderBodyCharacters} characters`,
  )
  .refine((body) => body.trim().length > 0, "Reminder body cannot be blank")
  .describe(
    "Literal one-pass template of 1 to 4,096 Unicode characters. Supported placeholders are exactly {{paciente}}, {{cliente}}, {{profissional}}, {{servico}}, {{data}}, {{hora}}, {{duracao}}, {{valor}}, and {{empresa}}; unknown placeholders remain unchanged.",
  );
const serviceReminderTemplate = z
  .object({
    label: z.string().nullable().optional(),
    days_before: reminderDaysBefore,
    hours_before: reminderHoursBefore,
    minutes_before: reminderMinutesBefore,
    body_template: reminderBodyTemplate,
    active: z.boolean().optional(),
    send_via: z.literal("whatsapp").default("whatsapp"),
  })
  .strict()
  .refine(
    (template) =>
      (template.days_before ?? 0) + (template.hours_before ?? 0) + (template.minutes_before ?? 0) >
      0,
    {
      message: "At least one reminder offset must be greater than zero",
      path: ["minutes_before"],
    },
  )
  .refine(
    (template) =>
      (template.days_before ?? 0) * 1_440 +
        (template.hours_before ?? 0) * 60 +
        (template.minutes_before ?? 0) <=
      maximumReminderOffsetMinutes,
    {
      message: `Total reminder offset must not exceed ${maximumReminderOffsetMinutes} minutes`,
      path: ["minutes_before"],
    },
  );

const serviceReminderTemplates = z
  .array(serviceReminderTemplate)
  .optional()
  .describe(
    "Replacement list of reminder templates; omit to preserve and pass [] to clear. Each body_template is 1 to 4,096 Unicode characters and supports exactly {{paciente}}, {{cliente}}, {{profissional}}, {{servico}}, {{data}}, {{hora}}, {{duracao}}, {{valor}}, and {{empresa}}.",
  );

const serviceIds = z
  .array(serviceId)
  .optional()
  .describe("Replacement list of account service IDs offered by the professional");

// Não é conjunto fechado: a conta nomeia os próprios tipos. Como enum, o zod
// recusaria um tipo criado pela conta antes mesmo de a requisição sair.
const partnerKind = z
  .string()
  .min(1)
  .max(40)
  .describe(
    "Partner type, up to 40 characters. convenio, seguro, plano and outros are the canonical values the NooviChat dashboard translates; any other value is stored and displayed as written.",
  );

const bulkAppointmentIds = z
  .array(appointmentId)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Appointment IDs must be unique",
  })
  .describe("Between 1 and 100 unique appointment IDs");

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "list_appointments",
    {
      title: "List appointments",
      description:
        "Return {data, meta} for appointments filtered by date, status, professional, service, partner, contact, pipeline card, or conversation.",
      inputSchema: {
        account_id: optionalAccountId,
        status: appointmentStatusFilter.optional(),
        professional_id: professionalId.optional(),
        service_id: serviceId.optional(),
        partner_id: partnerId.optional(),
        contact_id: contactId.optional(),
        pipeline_card_id: pipelineCardId.optional(),
        conversation_display_id: conversationDisplayId.optional(),
        from: absoluteDateTime.optional().describe("Start of the scheduled-at range"),
        to: absoluteDateTime.optional().describe("End of the scheduled-at range"),
        page: appointmentPage,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments`, params);
      }),
  );

  server.registerTool(
    "list_appointment_clients",
    {
      title: "List clients with appointments",
      description:
        "Return {data, meta} with the directory of contacts that have at least one appointment, aggregated over the ENTIRE history — no date window. Each row carries appointments_count plus last_appointment_at and next_appointment_at. Cancellations and no-shows count toward the total but never feed those two dates.",
      inputSchema: {
        account_id: optionalAccountId,
        q: z
          .string()
          .max(120)
          .optional()
          .describe(
            "Case-insensitive search over the contact name, email and phone. % and _ match literally.",
          ),
        sort: z
          .enum(["recent", "upcoming", "frequency", "name"])
          .optional()
          .describe(
            "recent (default): most recent visit first. upcoming: soonest next visit. frequency: most appointments. name: alphabetical. Clients missing the relevant date sort last.",
          ),
        page: z.number().int().min(1).optional().describe("Page number, 30 per page"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments/clients`, params);
      }),
  );

  server.registerTool(
    "get_appointment",
    {
      title: "Get appointment",
      description:
        "Return {data} with the exact appointment projection and compact contact, professional, service, and optional partner projections. Materialized reminders are not included.",
      inputSchema: { account_id: optionalAccountId, appointment_id: appointmentId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, appointment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments/${appointment_id}`);
      }),
  );

  server.registerTool(
    "create_appointment",
    {
      title: "Create appointment",
      description:
        "Create a scheduled appointment and return 201 {data} with the appointment projection. professional_id is required; use list_available_professionals to find a valid professional for a slot.",
      inputSchema: {
        account_id: optionalAccountId,
        contact_id: contactId,
        professional_id: professionalId,
        service_id: serviceId,
        partner_id: partnerId.nullable().optional(),
        scheduled_at: localDateTime,
        ends_at: localDateTime
          .nullable()
          .optional()
          .describe("Optional end; null or omission defaults from service duration"),
        notes: z.string().nullable().optional(),
        conversation_display_id: conversationDisplayId.nullable().optional(),
        pipeline_card_id: pipelineCardId.nullable().optional(),
        custom_attributes: customAttributes,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/appointments`, { appointment: body });
      }),
  );

  server.registerTool(
    "update_appointment",
    {
      title: "Update appointment",
      description:
        "Update only scheduled_at, notes, partner_id, or custom_attributes and return 200 {data}. Use dedicated tools for status transitions.",
      inputSchema: {
        account_id: optionalAccountId,
        appointment_id: appointmentId,
        scheduled_at: localDateTime.optional(),
        notes: z.string().nullable().optional(),
        partner_id: partnerId.nullable().optional(),
        custom_attributes: customAttributes,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, appointment_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/appointments/${appointment_id}`, {
          appointment: body,
        });
      }),
  );

  server.registerTool(
    "cancel_appointment",
    {
      title: "Cancel appointment",
      description:
        "Soft-cancel an appointment, preserve it for audit/reporting, and return {success:true} after the API's 204 response.",
      inputSchema: {
        account_id: accountId,
        appointment_id: appointmentId,
        reason: z.string().optional().describe("Optional cancellation reason"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, appointment_id, reason }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(
          `/api/v1/accounts/${acc}/appointments/${appointment_id}`,
          reason === undefined ? undefined : { reason },
        );
      }),
  );

  server.registerTool(
    "confirm_appointment",
    {
      title: "Confirm appointment",
      description:
        "Transition a scheduled appointment to confirmed and return 200 {data}; repeating an already-confirmed appointment is idempotent, while terminal statuses return 422.",
      inputSchema: { account_id: optionalAccountId, appointment_id: appointmentId },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, appointment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/appointments/${appointment_id}/confirm`);
      }),
  );

  server.registerTool(
    "complete_appointment",
    {
      title: "Complete appointment",
      description:
        "Transition a scheduled or confirmed appointment to completed and return 200 {data}; repeating an already-completed appointment is idempotent, while cancelled or no_show returns 422.",
      inputSchema: { account_id: accountId, appointment_id: appointmentId },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ account_id, appointment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/appointments/${appointment_id}/complete`);
      }),
  );

  server.registerTool(
    "mark_appointment_no_show",
    {
      title: "Mark appointment as no-show",
      description:
        "Transition a scheduled or confirmed appointment to no_show and return 200 {data}; repeating an already-no_show appointment is idempotent, while cancelled or completed returns 422.",
      inputSchema: { account_id: accountId, appointment_id: appointmentId },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ account_id, appointment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/appointments/${appointment_id}/no_show`);
      }),
  );

  server.registerTool(
    "bulk_appointment_action",
    {
      title: "Bulk appointment action",
      description:
        "Apply confirm, cancel, or no_show to 1-100 unique appointment IDs. Accepted batches return 200 {data:{action,count,succeeded,failed}}, including per-record transition failures; an inaccessible ID returns 404 before any action, and malformed input returns 422.",
      inputSchema: {
        account_id: accountId,
        bulk_action: z.enum(["confirm", "cancel", "no_show"]),
        ids: bulkAppointmentIds,
        reason: z
          .string()
          .nullable()
          .optional()
          .describe("Nullable cancellation reason for the cancel action"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/appointments/bulk_action`, body);
      }),
  );

  server.registerTool(
    "export_appointments_csv",
    {
      title: "Export appointments as CSV",
      description:
        "Export a privileged CSV using the same filters as list_appointments except pagination.",
      inputSchema: {
        account_id: optionalAccountId,
        status: appointmentStatusFilter.optional(),
        professional_id: professionalId.optional(),
        service_id: serviceId.optional(),
        partner_id: partnerId.optional(),
        contact_id: contactId.optional(),
        pipeline_card_id: pipelineCardId.optional(),
        conversation_display_id: conversationDisplayId.optional(),
        from: absoluteDateTime.optional(),
        to: absoluteDateTime.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments/export.csv`, params);
      }),
  );

  server.registerTool(
    "get_appointments_metrics",
    {
      title: "Get appointment metrics",
      description:
        "Return {data} with counts, no-show rate, revenue, professional/service breakdowns, daily series, and the effective date range.",
      inputSchema: {
        account_id: optionalAccountId,
        from: absoluteDateTime.optional(),
        to: absoluteDateTime.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments/metrics`, params);
      }),
  );

  server.registerTool(
    "get_appointment_availability",
    {
      title: "Get appointment availability slots",
      description:
        "Return {data:{date,professional_id,slots}} for one required professional and calendar date.",
      inputSchema: {
        account_id: optionalAccountId,
        professional_id: professionalId,
        date: calendarDate,
        service_id: serviceId.optional(),
        duration_minutes: durationMinutes
          .optional()
          .describe("Used when service_id is omitted; defaults to 60"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments/availability`, params);
      }),
  );

  server.registerTool(
    "get_appointment_availability_range",
    {
      title: "Get appointment availability slots over a range of days",
      description:
        "Same rules as get_appointment_availability, answered for every day from `from` to `to` inclusive in one call. " +
        "Returns {data:{professional_id,duration_minutes,days:[{date,slots}]}}. Every day in the range is present, " +
        "including days the professional does not work, which come back with an empty slots array — an absent day " +
        "could not be told apart from a day with nothing free. The range must span at most 42 days.",
      inputSchema: {
        account_id: optionalAccountId,
        professional_id: professionalId,
        from: calendarDate.describe("First day of the range (YYYY-MM-DD), inclusive"),
        to: calendarDate.describe(
          "Last day of the range (YYYY-MM-DD), inclusive; must not precede `from` and the range must be at most 42 days",
        ),
        service_id: serviceId.optional(),
        duration_minutes: durationMinutes
          .optional()
          .describe("Used when service_id is omitted; defaults to 60"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/appointments/availability_range`,
          params,
        );
      }),
  );

  server.registerTool(
    "list_available_professionals",
    {
      title: "List professionals available for a slot",
      description:
        "Return professionals whose working hours and existing appointments allow the requested slot; optionally restrict them to a service.",
      inputSchema: {
        account_id: optionalAccountId,
        scheduled_at: localDateTime,
        service_id: serviceId.optional(),
        duration_minutes: durationMinutes
          .optional()
          .describe("Used when service_id is omitted; defaults to 60"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments/available_professionals`, params);
      }),
  );

  server.registerTool(
    "list_services",
    {
      title: "List services",
      description: "Return {data} with all active, non-archived appointment services.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/services`);
      }),
  );

  server.registerTool(
    "get_service",
    {
      title: "Get service",
      description: "Return {data} for a service, including its reminder templates.",
      inputSchema: { account_id: optionalAccountId, service_id: serviceId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, service_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/services/${service_id}`);
      }),
  );

  server.registerTool(
    "create_service",
    {
      title: "Create service",
      description: "Create a bookable service and optionally configure its reminder templates.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        description: z.string().optional(),
        duration_minutes: durationMinutes,
        default_price_cents: z.number().int().nonnegative().optional(),
        currency: z.string().length(3).optional(),
        color: z.string().optional(),
        online_available: z.boolean().optional(),
        active: z.boolean().optional(),
        custom_attributes: customAttributes,
        reminder_templates: serviceReminderTemplates,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/services`, { service: body });
      }),
  );

  server.registerTool(
    "update_service",
    {
      title: "Update service",
      description:
        "Update a service. reminder_templates replaces the list when present, [] clears it, and omission preserves it.",
      inputSchema: {
        account_id: optionalAccountId,
        service_id: serviceId,
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        duration_minutes: durationMinutes.optional(),
        default_price_cents: z.number().int().nonnegative().optional(),
        currency: z.string().length(3).optional(),
        color: z.string().optional(),
        online_available: z.boolean().optional(),
        active: z.boolean().optional(),
        custom_attributes: customAttributes,
        reminder_templates: serviceReminderTemplates,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, service_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/services/${service_id}`, { service: body });
      }),
  );

  server.registerTool(
    "delete_service",
    {
      title: "Delete service",
      description:
        "Soft-delete a service while preserving historical appointments; returns {success:true} after 204.",
      inputSchema: { account_id: accountId, service_id: serviceId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, service_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/services/${service_id}`);
      }),
  );

  server.registerTool(
    "list_professionals",
    {
      title: "List professionals",
      description:
        "Return {data} with all active, non-archived professionals and their service IDs.",
      inputSchema: { account_id: optionalAccountId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/professionals`);
      }),
  );

  server.registerTool(
    "get_professional",
    {
      title: "Get professional",
      description: "Return {data} with a professional, service IDs, working hours, and avatar URL.",
      inputSchema: { account_id: optionalAccountId, professional_id: professionalId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, professional_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/professionals/${professional_id}`);
      }),
  );

  server.registerTool(
    "create_professional",
    {
      title: "Create professional",
      description:
        "Create a professional, set working hours, and optionally replace offered services.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        specialty: z.string().optional(),
        registry: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        color: z.string().optional(),
        buffer_minutes: z.number().int().nonnegative().optional(),
        active: z.boolean().optional(),
        working_hours: workingHours.optional(),
        custom_attributes: customAttributes,
        service_ids: serviceIds,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/professionals`, { professional: body });
      }),
  );

  server.registerTool(
    "update_professional",
    {
      title: "Update professional",
      description:
        "Update a professional. service_ids replaces offered services when present; omission preserves them.",
      inputSchema: {
        account_id: optionalAccountId,
        professional_id: professionalId,
        name: z.string().min(1).optional(),
        specialty: z.string().nullable().optional(),
        registry: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        color: z.string().optional(),
        buffer_minutes: z.number().int().nonnegative().optional(),
        active: z.boolean().optional(),
        working_hours: workingHours.optional(),
        custom_attributes: customAttributes,
        service_ids: serviceIds,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, professional_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/professionals/${professional_id}`, {
          professional: body,
        });
      }),
  );

  server.registerTool(
    "delete_professional",
    {
      title: "Delete professional",
      description:
        "Soft-delete a professional while preserving historical appointments; returns {success:true} after 204.",
      inputSchema: { account_id: accountId, professional_id: professionalId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, professional_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/professionals/${professional_id}`);
      }),
  );

  server.registerTool(
    "get_professional_availability",
    {
      title: "Get professional availability",
      description:
        "Return {data:{date,professional_id,slots}} for a professional. date defaults to the server's current date.",
      inputSchema: {
        account_id: optionalAccountId,
        professional_id: professionalId,
        date: calendarDate.optional(),
        service_id: serviceId.optional(),
        duration_minutes: durationMinutes
          .optional()
          .describe("Used when service_id is omitted; defaults to 60"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, professional_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/professionals/${professional_id}/availability`,
          params,
        );
      }),
  );

  server.registerTool(
    "list_partners",
    {
      title: "List partners",
      description:
        "Return {data} with the account's non-archived appointment partners, ordered by name. Active ones only unless include_inactive is set — a deactivated partner is otherwise unreachable, including to reactivate it.",
      inputSchema: {
        account_id: optionalAccountId,
        include_inactive: z
          .boolean()
          .optional()
          .describe("Include partners whose active flag is false"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, include_inactive }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        const query = include_inactive ? "?include_inactive=true" : "";
        return client.get(`/api/v1/accounts/${acc}/partners${query}`);
      }),
  );

  server.registerTool(
    "get_partner",
    {
      title: "Get partner",
      description: "Return {data} for an appointment partner.",
      inputSchema: { account_id: optionalAccountId, partner_id: partnerId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, partner_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/partners/${partner_id}`);
      }),
  );

  server.registerTool(
    "create_partner",
    {
      title: "Create partner",
      description: "Create an appointment partner such as a convenio, insurer, or health plan.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        kind: partnerKind.optional(),
        active: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/partners`, { partner: body });
      }),
  );

  server.registerTool(
    "update_partner",
    {
      title: "Update partner",
      description: "Update a partner's name, kind, active state, or settings.",
      inputSchema: {
        account_id: optionalAccountId,
        partner_id: partnerId,
        name: z.string().min(1).optional(),
        kind: partnerKind.optional(),
        active: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, partner_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/partners/${partner_id}`, { partner: body });
      }),
  );

  server.registerTool(
    "delete_partner",
    {
      title: "Delete partner",
      description:
        "Soft-delete a partner while preserving historical appointment links; returns {success:true} after 204.",
      inputSchema: { account_id: accountId, partner_id: partnerId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, partner_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/partners/${partner_id}`);
      }),
  );
};
