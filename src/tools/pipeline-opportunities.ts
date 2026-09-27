/**
 * Pipeline Pro — product catalog and the per-card financial ledger
 * (opportunities / recorded sales). Fase 59.
 *
 * Routes (Chatwoot/config/routes.rb, `namespace :pipeline`):
 *   Products (Pipeline::ProductsController):
 *     GET    /api/v1/accounts/:account_id/pipeline/products
 *     GET    /api/v1/accounts/:account_id/pipeline/products/performance
 *     GET    /api/v1/accounts/:account_id/pipeline/products/:id
 *     POST   /api/v1/accounts/:account_id/pipeline/products
 *     PATCH  /api/v1/accounts/:account_id/pipeline/products/:id (PUT alias)
 *     DELETE /api/v1/accounts/:account_id/pipeline/products/:id   (deactivates)
 *
 *   Opportunities (Pipeline::OpportunitiesController / OpportunitiesReportsController):
 *     GET    /api/v1/accounts/:account_id/pipeline/cards/:card_id/opportunities
 *     POST   /api/v1/accounts/:account_id/pipeline/cards/:card_id/opportunities
 *     POST   /api/v1/accounts/:account_id/pipeline/opportunities/:id/void
 *     GET    /api/v1/accounts/:account_id/pipeline/opportunities/report
 *
 * Feature gate: every route here requires the account cross feature
 * `pipeline_opportunities` (403 `code: "pipeline_opportunities_disabled"`),
 * EXCEPT listing a card's opportunities and voiding one, which are core.
 *
 * The normal way a sale is recorded is winning the card (mark_card_won). The
 * POST .../opportunities route records an extra sale without moving the card.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { accountId, optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

const productId = z.number().int().positive().describe("Pipeline product ID");
const cardId = z.number().int().positive().describe("Pipeline card ID");
const opportunityId = z.number().int().positive().describe("Pipeline opportunity ID");
const pipelineFilter = z
  .number()
  .int()
  .positive()
  .describe("Restrict to one pipeline (404 when it does not exist or is not visible)");
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Calendar date YYYY-MM-DD, interpreted in the account timezone");
const offset = z
  .number()
  .int()
  .min(0)
  .max(10_000_000)
  .optional()
  .describe("Rows to skip (default 0)");
// Money is validated server-side as a non-negative decimal string; numbers and
// decimal strings both serialize to what the controller accepts.
const money = z.union([z.number().min(0), z.string().regex(/^\d+(\.\d+)?$/)]);

const productFields = {
  sku: z.string().max(64).nullable().optional().describe("Unique per account"),
  description: z.string().nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  default_value: z
    .number()
    .min(0)
    .max(999_999_999_999.99)
    .nullable()
    .optional()
    .describe("Suggested unit value"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .describe("Three-letter uppercase code. Omitted on create = the account's currency"),
  active: z.boolean().optional(),
  position: z.number().int().min(0).optional().describe("Sort order in the catalog"),
  pipeline_ids: z
    .array(z.number().int().positive())
    .optional()
    .describe("Pipelines where the product is offered. [] = every pipeline"),
};

const saleItem = z
  .object({
    pipeline_product_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Active product of this account available in the card's pipeline"),
    title: z.string().max(255).optional(),
    quantity: money.optional().describe("> 0, up to 3 decimal places (default 1)"),
    unit_value: money.optional(),
    total_value: money
      .optional()
      .describe(
        "Required without unit_value; when both are sent it must equal quantity * unit_value",
      ),
    note: z.string().optional(),
    custom_attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .describe("One line of an itemized sale");

export const register: RegisterFn = (server, client) => {
  // ── Products ───────────────────────────────────────────────────────────────
  server.registerTool(
    "list_pipeline_products",
    {
      title: "List pipeline products",
      description:
        "List the account's product catalog in catalog order. Response: { products, meta: { limit, offset, total_count } }.",
      inputSchema: {
        account_id: optionalAccountId,
        active_only: z.boolean().optional().describe("Only active products"),
        pipeline_id: pipelineFilter
          .optional()
          .describe("Only products offered in this pipeline (unrestricted products included)"),
        per_page: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Page size (default 50, max 200)"),
        offset,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/products`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_products_performance",
    {
      title: "Get product sales performance",
      description:
        "How much each product sold in a period, including products that sold nothing, plus `unlinked` sales with no product. Agents only see pipelines they belong to. Response: { products: [{ id, name, currency, performance }], unlinked, meta }.",
      inputSchema: {
        account_id: optionalAccountId,
        won_start: calendarDate.optional().describe("Won-at range start (YYYY-MM-DD)"),
        won_end: calendarDate
          .optional()
          .describe("Won-at range end (YYYY-MM-DD), not before won_start"),
        pipeline_id: pipelineFilter.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/products/performance`, params);
      }),
  );

  server.registerTool(
    "get_pipeline_product",
    {
      title: "Get pipeline product",
      description: "Read one product of the catalog. Response: { product }.",
      inputSchema: { account_id: optionalAccountId, product_id: productId },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, product_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/products/${product_id}`);
      }),
  );

  server.registerTool(
    "create_pipeline_product",
    {
      title: "Create pipeline product",
      description:
        "Add a product to the catalog. 422 { errors } on validation failure or a duplicate SKU. Response: { product }.",
      inputSchema: {
        account_id: optionalAccountId,
        name: z.string().min(1).max(255),
        ...productFields,
      },
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(`/api/v1/accounts/${acc}/pipeline/products`, {
          pipeline_product: body,
        });
      }),
  );

  server.registerTool(
    "update_pipeline_product",
    {
      title: "Update pipeline product",
      description:
        "Update a catalog product. Only the fields sent are changed; send active: true to reactivate. Response: { product }.",
      inputSchema: {
        account_id: optionalAccountId,
        product_id: productId,
        name: z.string().min(1).max(255).optional(),
        ...productFields,
      },
      annotations: { idempotentHint: true },
    },
    async ({ account_id, product_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.patch(`/api/v1/accounts/${acc}/pipeline/products/${product_id}`, {
          pipeline_product: body,
        });
      }),
  );

  server.registerTool(
    "deactivate_pipeline_product",
    {
      title: "Deactivate pipeline product",
      description:
        "DELETE a product: it is deactivated (active: false), never erased, because recorded sales reference it. Reversible with update_pipeline_product active: true. Response: { product }.",
      inputSchema: { account_id: accountId, product_id: productId },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ account_id, product_id }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.delete(`/api/v1/accounts/${acc}/pipeline/products/${product_id}`);
      }),
  );

  // ── Opportunities (per-card ledger) ────────────────────────────────────────
  server.registerTool(
    "list_card_opportunities",
    {
      title: "List card opportunities",
      description:
        "List the sales recorded on a card (chronological), including voided ones, with a summary computed from the whole ledger (total, count, voided_count, history_count, last_opportunity_at, currency). Response: { opportunities, summary, meta: { limit, offset, total_count } }.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        per_page: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Page size (default 50, max 100)"),
        offset,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, card_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(
          `/api/v1/accounts/${acc}/pipeline/cards/${card_id}/opportunities`,
          params,
        );
      }),
  );

  server.registerTool(
    "record_card_opportunity",
    {
      title: "Record a sale on a card",
      description:
        "Record an extra sale on a card WITHOUT moving it (the normal path is mark_card_won). Send either `items` (itemized, 1-50 lines) or the flat total_value/unit_value/quantity/pipeline_product_id. " +
        "The sale is dated now. 409 when the current cycle already has a recorded sale; 422 on invalid input. Requires the pipeline_opportunities feature. Response: { opportunity }.",
      inputSchema: {
        account_id: optionalAccountId,
        card_id: cardId,
        title: z.string().optional(),
        note: z.string().optional(),
        total_value: money.optional().describe("Flat sale total (ignored when items is sent)"),
        unit_value: money.optional(),
        quantity: money.optional(),
        pipeline_product_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Product of this account (404 when not found)"),
        items: z.array(saleItem).min(1).max(50).optional(),
      },
    },
    async ({ account_id, card_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        // The controller reads these fields at the JSON root (no wrapper).
        return client.post(`/api/v1/accounts/${acc}/pipeline/cards/${card_id}/opportunities`, body);
      }),
  );

  server.registerTool(
    "void_opportunity",
    {
      title: "Void (reverse) an opportunity",
      description:
        "Reverse a recorded sale. The row is NOT deleted: it is marked voided with author, date and reason, and the card totals are recalculated. Cannot be undone. " +
        "409 when it is already voided; 422 when reason is missing. Response: { opportunity }.",
      inputSchema: {
        account_id: accountId,
        opportunity_id: opportunityId,
        reason: z.string().min(1).max(255).describe("Why the sale is being reversed (required)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ account_id, opportunity_id, reason }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.post(
          `/api/v1/accounts/${acc}/pipeline/opportunities/${opportunity_id}/void`,
          {
            reason,
          },
        );
      }),
  );

  server.registerTool(
    "get_opportunities_report",
    {
      title: "Get opportunities report",
      description:
        "Account-level revenue report from the sales ledger: period, totals_by_currency, voided_by_currency, by_pipeline, by_seller, by_source, timeline and repeat purchases. Agents only see pipelines they belong to. Requires the pipeline_opportunities feature.",
      inputSchema: {
        account_id: optionalAccountId,
        start_date: calendarDate.optional(),
        end_date: calendarDate.optional().describe("Not before start_date (YYYY-MM-DD)"),
        pipeline_id: pipelineFilter.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ account_id, ...params }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/pipeline/opportunities/report`, params);
      }),
  );
};
