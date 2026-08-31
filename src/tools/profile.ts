/**
 * Profile — discover the agent bound to the API token and the accounts
 * they can operate. This is the only core Chatwoot surface in this server:
 * conversation/contact/message/inbox CRUD stays in
 * `@nooviai/n8n-nodes-noovichat` and the REST API.
 *
 * Route:
 *   GET /api/v1/profile
 *
 * No `account_id` in the path. The token identifies the user; the payload
 * lists memberships so the operator can set `NOOVICHAT_ACCOUNT_ID` or pass
 * `account_id` on subsequent tools.
 */

import type { RegisterFn } from "../types.js";
import { safeHandler } from "./_helpers.js";

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "get_profile",
    {
      title: "Get API token profile",
      description:
        "Return the agent (or bot) bound to NOOVICHAT_API_TOKEN and the accounts they belong to. Use the account `id` as `account_id` on other tools when NOOVICHAT_ACCOUNT_ID is unset. This is not conversation/contact/inbox CRUD.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => safeHandler(() => client.get("/api/v1/profile")),
  );
};
