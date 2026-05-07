/**
 * Atendimentos (Appointments / Bookings) — NooviChat custom feature.
 *
 * Routes (Chatwoot/config/routes.rb 694-719):
 *   /api/v1/accounts/:account_id/appointments
 *     - GET    /                             (index)
 *     - GET    /:id                          (show)
 *     - POST   /                             (create)
 *     - PATCH  /:id                          (update)
 *     - DELETE /:id                          (destroy / cancel)
 *     - POST   /:id/confirm
 *     - POST   /:id/complete
 *     - POST   /:id/no_show
 *     - POST   /:id/sync_to_google
 *     - GET    /availability                 (collection)
 *     - POST   /bulk_action                  (collection)
 *     - GET    /export.csv                   (collection)
 *     - GET    /metrics                      (collection)
 *
 *   /api/v1/accounts/:account_id/professionals
 *     - Standard CRUD + GET /:id/availability
 *
 *   /api/v1/accounts/:account_id/services       (CRUD)
 *   /api/v1/accounts/:account_id/partners       (CRUD)
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  accountId,
  contactId,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const appointmentId = z.number().int().positive().describe("Appointment ID");
const professionalId = z.number().int().positive().describe("Professional ID");
const serviceId = z.number().int().positive().describe("Service ID");
const partnerId = z.number().int().positive().describe("Partner ID");

const appointmentStatus = z
  .enum(["pending", "confirmed", "completed", "no_show", "cancelled"])
  .describe("Appointment status");

const isoDate = z.string().describe("ISO8601 date or datetime");

export const register: RegisterFn = (server, client) => {
  // ── Appointments — list / read / write ─────────────────────────────────────
  server.registerTool(
    "list_appointments",
    {
      title: "List appointments",
      description:
        "List appointments filtered by status, professional, service, partner, contact, or date range.",
      inputSchema: {
        account_id: optionalAccountId,
        status: appointmentStatus.optional(),
        professional_id: professionalId.optional(),
        service_id: serviceId.optional(),
        partner_id: partnerId.optional(),
        contact_id: contactId.optional(),
        from: isoDate.optional().describe("Start of date range"),
        to: isoDate.optional().describe("End of date range"),
        ...pagination,
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
    "get_appointment",
    {
      title: "Get appointment",
      description: "Read full detail of an appointment (contact, service, professional, status).",
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
      description: "Schedule a new appointment for a contact with a professional and service.",
      inputSchema: {
        account_id: optionalAccountId,
        contact_id: contactId,
        service_id: serviceId,
        professional_id: professionalId.optional(),
        partner_id: partnerId.optional(),
        scheduled_at: isoDate.describe("ISO8601 datetime when the appointment starts"),
        duration_minutes: z.number().int().positive().optional(),
        notes: z.string().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/appointments`, { appointment: body });
      }),
  );

  server.registerTool(
    "update_appointment",
    {
      title: "Update appointment",
      description: "Update an appointment's scheduling, professional, notes or custom_attributes.",
      inputSchema: {
        account_id: optionalAccountId,
        appointment_id: appointmentId,
        scheduled_at: isoDate.optional(),
        duration_minutes: z.number().int().positive().optional(),
        professional_id: professionalId.optional(),
        partner_id: partnerId.optional(),
        service_id: serviceId.optional(),
        notes: z.string().optional(),
        status: appointmentStatus.optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
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
        "Cancel an appointment (DELETE). Cancellation is logged and reminders/Google sync are revoked.",
      inputSchema: { account_id: accountId, appointment_id: appointmentId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, appointment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/appointments/${appointment_id}`);
      }),
  );

  // ── Status transitions ─────────────────────────────────────────────────────
  server.registerTool(
    "confirm_appointment",
    {
      title: "Confirm appointment",
      description: "Mark an appointment as confirmed (status → confirmed).",
      inputSchema: { account_id: optionalAccountId, appointment_id: appointmentId },
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
      description: "Mark an appointment as completed (after the service was performed).",
      inputSchema: { account_id: optionalAccountId, appointment_id: appointmentId },
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
      description: "Mark an appointment as no_show when the contact didn't appear.",
      inputSchema: { account_id: optionalAccountId, appointment_id: appointmentId },
    },
    async ({ account_id, appointment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/appointments/${appointment_id}/no_show`);
      }),
  );

  server.registerTool(
    "sync_appointment_to_google_calendar",
    {
      title: "Sync appointment to Google Calendar",
      description:
        "Push an appointment to the connected Google Calendar (creates or updates the event).",
      inputSchema: { account_id: optionalAccountId, appointment_id: appointmentId },
    },
    async ({ account_id, appointment_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/appointments/${appointment_id}/sync_to_google`);
      }),
  );

  // ── Bulk action / collection endpoints ─────────────────────────────────────
  server.registerTool(
    "bulk_appointment_action",
    {
      title: "Bulk appointment action",
      description:
        "Apply an action (confirm, cancel, complete, no_show, delete) to many appointments at once.",
      inputSchema: {
        account_id: accountId,
        action: z
          .enum(["confirm", "cancel", "complete", "no_show", "delete"])
          .describe("Bulk action verb"),
        ids: z.array(appointmentId).min(1).describe("Appointment IDs to act on"),
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
      description: "Export appointments matching the filter as CSV (GET /appointments/export.csv).",
      inputSchema: {
        account_id: optionalAccountId,
        status: appointmentStatus.optional(),
        professional_id: professionalId.optional(),
        service_id: serviceId.optional(),
        partner_id: partnerId.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
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
      title: "Get appointments metrics",
      description:
        "Return aggregated metrics for appointments (counts by status, no-show rate, etc.).",
      inputSchema: {
        account_id: optionalAccountId,
        from: isoDate.optional(),
        to: isoDate.optional(),
        professional_id: professionalId.optional(),
        service_id: serviceId.optional(),
        partner_id: partnerId.optional(),
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
        "List available time slots for booking, optionally filtered by service, professional, and date range.",
      inputSchema: {
        account_id: optionalAccountId,
        service_id: serviceId.optional(),
        professional_id: professionalId.optional(),
        from: isoDate.optional().describe("ISO8601 datetime — start of search window"),
        to: isoDate.optional().describe("ISO8601 datetime — end of search window"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/appointments/availability`, params);
      }),
  );

  // ── Services (catálogo de serviços) ────────────────────────────────────────
  server.registerTool(
    "list_services",
    {
      title: "List services",
      description: "List all bookable services for the account.",
      inputSchema: { account_id: optionalAccountId, ...pagination },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/services`, params);
      }),
  );

  server.registerTool(
    "get_service",
    {
      title: "Get service",
      description: "Get a specific bookable service by ID.",
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
      description: "Create a new bookable service (name, duration, price, etc.).",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        description: z.string().optional(),
        duration_minutes: z.number().int().positive().optional(),
        price_cents: z.number().int().nonnegative().optional(),
        currency: z.string().optional().describe("ISO 4217 currency code (e.g. BRL)"),
        active: z.boolean().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/services`, { service: body });
      }),
  );

  server.registerTool(
    "update_service",
    {
      title: "Update service",
      description: "Update a service (name, duration, price, active flag).",
      inputSchema: {
        account_id: optionalAccountId,
        service_id: serviceId,
        name: z.string().optional(),
        description: z.string().optional(),
        duration_minutes: z.number().int().positive().optional(),
        price_cents: z.number().int().nonnegative().optional(),
        currency: z.string().optional(),
        active: z.boolean().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
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
      description: "Delete a service. Existing appointments referencing it are NOT deleted.",
      inputSchema: { account_id: accountId, service_id: serviceId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, service_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/services/${service_id}`);
      }),
  );

  // ── Professionals ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_professionals",
    {
      title: "List professionals",
      description: "List professionals (agents that perform appointments) for the account.",
      inputSchema: { account_id: optionalAccountId, ...pagination },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/professionals`, params);
      }),
  );

  server.registerTool(
    "get_professional",
    {
      title: "Get professional",
      description: "Get a specific professional, including their service list and working hours.",
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
        "Register a new professional (associated with an agent user, partner, services).",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        email: z.string().optional(),
        user_id: z.number().int().positive().optional().describe("Linked agent user ID"),
        partner_id: partnerId.optional(),
        service_ids: z.array(serviceId).optional(),
        working_hours: z.record(z.string(), z.unknown()).optional(),
        active: z.boolean().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/professionals`, { professional: body });
      }),
  );

  server.registerTool(
    "update_professional",
    {
      title: "Update professional",
      description: "Update a professional's services, working hours, or active state.",
      inputSchema: {
        account_id: optionalAccountId,
        professional_id: professionalId,
        name: z.string().optional(),
        email: z.string().optional(),
        partner_id: partnerId.optional(),
        service_ids: z.array(serviceId).optional(),
        working_hours: z.record(z.string(), z.unknown()).optional(),
        active: z.boolean().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
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
      description: "Delete a professional. Existing appointments referencing them are not removed.",
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
      description: "Get a professional's available time slots within a date window.",
      inputSchema: {
        account_id: optionalAccountId,
        professional_id: professionalId,
        from: isoDate.optional(),
        to: isoDate.optional(),
        service_id: serviceId.optional(),
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

  // ── Partners (multi-location) ──────────────────────────────────────────────
  server.registerTool(
    "list_partners",
    {
      title: "List partners",
      description: "List partner locations (used for multi-site operations).",
      inputSchema: { account_id: optionalAccountId, ...pagination },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/partners`, params);
      }),
  );

  server.registerTool(
    "get_partner",
    {
      title: "Get partner",
      description: "Get a specific partner location by ID.",
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
      description: "Create a new partner location (address, contact info).",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1),
        address: z.string().optional(),
        phone_number: z.string().optional(),
        email: z.string().optional(),
        active: z.boolean().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/partners`, { partner: body });
      }),
  );

  server.registerTool(
    "update_partner",
    {
      title: "Update partner",
      description: "Update a partner location's details.",
      inputSchema: {
        account_id: optionalAccountId,
        partner_id: partnerId,
        name: z.string().optional(),
        address: z.string().optional(),
        phone_number: z.string().optional(),
        email: z.string().optional(),
        active: z.boolean().optional(),
        custom_attributes: z.record(z.string(), z.unknown()).optional(),
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
      description: "Delete a partner location.",
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
