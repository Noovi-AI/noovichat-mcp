/**
 * Shared zod fragments and helpers reused across tool modules.
 *
 * Conventions:
 *   - All numeric IDs are `z.number()` (Rails serial IDs)
 *   - All textual identifiers (display_id-style) are also `z.number()` because
 *     NooviChat uses bigint per-account sequences, not UUIDs
 *   - Account scope is required for every tool — most are nested under
 *     `/api/v1/accounts/:account_id/...`. The `accountId` schema is shared.
 *   - `defaultAccountId()` reads the `NOOVICHAT_ACCOUNT_ID` env var as a
 *     fallback so single-tenant operators don't need to pass it on every call.
 */

import { z } from "zod";
import { NooviChatApiError } from "../client.js";

/* -------------------------------------------------------------------------- */
/* Reusable zod fragments                                                     */
/* -------------------------------------------------------------------------- */

export const accountId = z
  .number()
  .int()
  .positive()
  .describe("NooviChat account ID. If omitted, falls back to NOOVICHAT_ACCOUNT_ID env var.");

export const optionalAccountId = accountId.optional();

export const conversationDisplayId = z
  .number()
  .int()
  .positive()
  .describe("Conversation display ID (per-account sequence, not the global UUID)");

export const contactId = z.number().int().positive().describe("Contact ID");

export const inboxId = z.number().int().positive().describe("Inbox ID");

export const agentUserId = z.number().int().positive().describe("Agent (User) ID");

export const teamId = z.number().int().positive().describe("Team ID");

export const labelSlug = z.string().min(1).describe("Label slug (lowercase string identifier)");

export const customAttributes = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Free-form custom attributes object (key/value pairs)");

export const pagination = {
  page: z.number().int().positive().optional().describe("Page number (1-indexed, default 1)"),
  per_page: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Items per page (default 25, max 100)"),
};

/* -------------------------------------------------------------------------- */
/* Response wrapping                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Convert any value to the uniform MCP text-content payload.
 * Mirrors the convention used by mcp-chatwoot (and required by the SDK):
 * `{ content: [{ type: "text", text: ... }] }`.
 */
export function jsonText(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        // Guard against `undefined` (e.g. 204 responses): JSON.stringify(undefined)
        // returns `undefined`, not a string, which makes the MCP result invalid.
        text: JSON.stringify(value === undefined ? { success: true } : value, null, 2),
      },
    ],
  };
}

/**
 * Wrap an async tool handler so that NooviChatApiError surfaces as a structured
 * MCP error payload instead of an unhandled throw. Other errors bubble up.
 */
export function safeHandler<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  return fn()
    .then((result) => jsonText(result))
    .catch((err) => {
      if (err instanceof NooviChatApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: true,
                  status: err.status,
                  path: err.path,
                  message: err.message,
                  errors: err.errors,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      throw err;
    });
}

/* -------------------------------------------------------------------------- */
/* Account ID resolution                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the account ID from explicit input, falling back to env var.
 * Throws if neither is set — early failure with a clear message.
 */
export function resolveAccountId(explicit?: number): number {
  if (explicit !== undefined && Number.isInteger(explicit) && explicit > 0) {
    return explicit;
  }
  const env = process.env.NOOVICHAT_ACCOUNT_ID;
  if (env) {
    const parsed = Number.parseInt(env, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error("account_id is required: pass it explicitly or set NOOVICHAT_ACCOUNT_ID env var");
}
