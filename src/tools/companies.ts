/**
 * Companies — B2B contact grouping (NooviChat-custom).
 *
 * Group contacts under company entities to support B2B sales workflows.
 * Companies are referenced by pipeline cards and surfaced in analytics.
 *
 * Routes (Chatwoot/config/routes.rb 272-276):
 *   resources :companies, only: [:index, :show, :create, :update, :destroy] do
 *     collection do
 *       get :search
 *     end
 *   end
 *
 * Base path: /api/v1/accounts/:account_id/companies
 *
 * NOTE: the controller (companies_controller.rb) implements many additional
 * actions (analytics, contacts, link_contacts, metrics, merge,
 * portfolio_analytics, attention_needed, import, update_health_scores) but
 * routes.rb only exposes the standard CRUD plus collection :search. The
 * extra controller methods are unreachable via the API today, so no MCP
 * tools are emitted for them. If routes are added later, register
 * `list_company_contacts`, `add_contact_to_company`,
 * `remove_contact_from_company` and `get_company_metrics` here.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  customAttributes,
  optionalAccountId,
  pagination,
  resolveAccountId,
  safeHandler,
} from "./_helpers.js";

const companyId = z.number().int().positive().describe("Company ID");

const companyAttributes = {
  name: z.string().min(1).describe("Company legal/display name"),
  domain: z.string().optional().describe("Primary email/web domain"),
  industry: z.string().optional(),
  size: z
    .enum(["solo", "small", "medium", "large", "enterprise"])
    .optional()
    .describe("Company size bucket"),
  website: z.string().optional(),
  phone_number: z.string().optional(),
  description: z.string().optional(),
  custom_attributes: customAttributes,
};

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description:
        "List companies for the account. Use `q` for free-text matching against name/domain (server-side search filter).",
      inputSchema: {
        account_id: optionalAccountId,
        q: z.string().optional().describe("Search query (matched against name/domain)"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/companies`, params);
      }),
  );

  server.registerTool(
    "get_company",
    {
      title: "Get company",
      description:
        "Read a single company with detailed serialization (linked contacts count, custom_attributes, metrics).",
      inputSchema: { account_id: optionalAccountId, company_id: companyId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, company_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/companies/${company_id}`);
      }),
  );

  server.registerTool(
    "search_companies",
    {
      title: "Search companies",
      description:
        "Server-side full-text search over companies. Useful for autocomplete UIs and lookup before linking contacts.",
      inputSchema: {
        account_id: optionalAccountId,
        q: z.string().min(1).describe("Search query"),
        ...pagination,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/companies/search`, params);
      }),
  );

  server.registerTool(
    "create_company",
    {
      title: "Create company",
      description:
        "Create a new company. Only `name` is required; remaining fields enrich the record.",
      inputSchema: {
        account_id: optionalAccountId,
        ...companyAttributes,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id as number | undefined);
        return client.post(`/api/v1/accounts/${acc}/companies`, body);
      }),
  );

  server.registerTool(
    "update_company",
    {
      title: "Update company",
      description: "Update an existing company. All fields are optional; pass only what changed.",
      inputSchema: {
        account_id: optionalAccountId,
        company_id: companyId,
        name: z.string().min(1).optional(),
        domain: z.string().optional(),
        industry: z.string().optional(),
        size: z.enum(["solo", "small", "medium", "large", "enterprise"]).optional(),
        website: z.string().optional(),
        phone_number: z.string().optional(),
        description: z.string().optional(),
        custom_attributes: customAttributes,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, company_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/companies/${company_id}`, body);
      }),
  );

  server.registerTool(
    "delete_company",
    {
      title: "Delete company",
      description:
        "Delete a company. Linked contacts are unlinked but preserved. Returns 204 on success, 422 if the service refuses (e.g., in-use).",
      // accountId is optional — falls back to NOOVICHAT_ACCOUNT_ID env var, like every other tool
      inputSchema: { account_id: optionalAccountId, company_id: companyId },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, company_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/companies/${company_id}`);
      }),
  );

  // TODO: verify route — controller implements `contacts`, `link_contacts`,
  // `metrics`, `merge`, `portfolio_analytics`, `attention_needed`, `import`,
  // `update_health_scores` but none are mounted in routes.rb today. Add
  // tools (list_company_contacts, add_contact_to_company,
  // remove_contact_from_company, get_company_metrics) once routes are
  // added.
};
