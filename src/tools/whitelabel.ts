/**
 * Whitelabel — SuperAdmin branding / AI / scripts panel.
 *
 * Routes (Chatwoot/config/routes.rb 1037-1061):
 *   GET    /super_admin/whitelabel                 → show (HTML)
 *   POST   /super_admin/whitelabel                 → create (form, redirects)
 *   GET    /super_admin/whitelabel/safe_mode       → HTML
 *   GET    /super_admin/whitelabel/backups         → JSON
 *   POST   /super_admin/whitelabel/restore_backup  → form/redirect
 *   POST   /super_admin/whitelabel/analyze_script  → JSON
 *   POST   /super_admin/whitelabel/chat            → JSON
 *   POST   /super_admin/whitelabel/test_ai_connection → JSON
 *   POST   /super_admin/whitelabel/update_ai_config   → JSON
 *   POST   /super_admin/whitelabel/export_scripts     → file download
 *   POST   /super_admin/whitelabel/import_scripts     → form/redirect
 *   GET    /super_admin/whitelabel/diff_backup        → JSON
 *   GET    /super_admin/whitelabel/audit_logs         → JSON
 *   GET    /super_admin/whitelabel/credentials_status → JSON
 *   GET    /super_admin/whitelabel/all_credentials    → JSON
 *   POST   /super_admin/whitelabel/activate_credential → JSON
 *   DELETE /super_admin/whitelabel/delete_credential   → JSON
 *   POST   /super_admin/whitelabel/migrate_credentials → JSON
 *   POST   /super_admin/whitelabel/upload_logo         → JSON (multipart — see note)
 *   DELETE /super_admin/whitelabel/delete_logo         → JSON
 *   GET    /super_admin/whitelabel/email_template      → JSON
 *   POST   /super_admin/whitelabel/email_template      → JSON (save)
 *   DELETE /super_admin/whitelabel/email_template      → JSON (delete)
 *
 * AUTH WARNING — IMPORTANT:
 *   These routes live under `/super_admin/...` and are protected by
 *   `before_action :authenticate_super_admin!` (Devise session). They do
 *   NOT accept the `api_access_token` header that NooviChatClient uses
 *   for `/api/v1/accounts/...` endpoints. With the current client a call
 *   to any of these tools returns 302 redirect to the super_admin login
 *   page (or 401 depending on the request format).
 *
 *   To use these tools in production the deploy needs one of:
 *     (a) Run the MCP server inside a session-authenticated context with a
 *         super_admin cookie (rare in agent deployments).
 *     (b) Add a `lib/super_admin/api_authentication.rb` concern accepting
 *         a SuperAdmin-scoped API token, then mirror these endpoints
 *         under `/super_admin/api/v1/whitelabel/*` returning JSON only.
 *     (c) Front the MCP server with a reverse-proxy that injects the
 *         SuperAdmin Devise cookie on outgoing calls.
 *
 *   We register the tools anyway because (i) the routes do exist and the
 *   MCP catalog stays useful for documentation/codegen, (ii) operators
 *   running their own session-authenticated bridge can hit them, and
 *   (iii) the auth requirement is loudly documented in each tool's
 *   description so consumers see it before invoking.
 *
 * Endpoints intentionally OMITTED (HTML-only, not useful for MCP):
 *   - GET /super_admin/whitelabel              (renders show.html.erb)
 *   - GET /super_admin/whitelabel/safe_mode    (HTML)
 *   - POST /super_admin/whitelabel             (form-encoded, redirects)
 *   - POST /super_admin/whitelabel/restore_backup (redirects)
 *   - POST /super_admin/whitelabel/import_scripts (multipart + redirect)
 *   - POST /super_admin/whitelabel/export_scripts (file download)
 *
 * Endpoints with multipart limitations:
 *   - upload_logo: the controller expects `params[:logo]` as an uploaded
 *     file. The MCP client only ships JSON bodies, so we expose a
 *     `source_url` parameter that the operator-side bridge MAY translate
 *     to a file upload. Without that bridge the call won't succeed; this
 *     is documented in the tool description.
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { safeHandler } from "./_helpers.js";

const SUPER_ADMIN_AUTH_NOTE =
  "REQUIRES SuperAdmin Devise session auth — NOT api_access_token. " +
  "See module JSDoc for deployment requirements.";

export const register: RegisterFn = (server, client) => {
  // ── Read-only / inspection ────────────────────────────────────────────────
  server.registerTool(
    "get_whitelabel_credentials_status",
    {
      title: "Get whitelabel credentials status",
      description: `Return active AI provider, configured model and whether a key is set. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => safeHandler(() => client.get("/super_admin/whitelabel/credentials_status")),
  );

  server.registerTool(
    "list_whitelabel_credentials",
    {
      title: "List all stored whitelabel AI credentials",
      description: `List every stored provider credential (active + inactive). ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => safeHandler(() => client.get("/super_admin/whitelabel/all_credentials")),
  );

  server.registerTool(
    "list_whitelabel_backups",
    {
      title: "List script backups",
      description: `List timestamped backups of the dashboard custom-scripts config. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => safeHandler(() => client.get("/super_admin/whitelabel/backups")),
  );

  server.registerTool(
    "diff_whitelabel_backup",
    {
      title: "Diff a backup against current scripts",
      description: `Return the diff between a stored backup and the currently active scripts. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        timestamp: z
          .string()
          .min(1)
          .describe("Backup timestamp/ID returned by list_whitelabel_backups"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ timestamp }) =>
      safeHandler(() => client.get("/super_admin/whitelabel/diff_backup", { timestamp })),
  );

  server.registerTool(
    "list_whitelabel_audit_logs",
    {
      title: "List whitelabel audit logs",
      description: `Return the most recent 50 audit log entries (script edits, branding changes, credential rotations). ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => safeHandler(() => client.get("/super_admin/whitelabel/audit_logs")),
  );

  server.registerTool(
    "get_whitelabel_email_template",
    {
      title: "Get whitelabel email template",
      description: `Load a single email template by name (and optional locale). ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        name: z.string().min(1).describe("Template name (e.g. 'agent_invite', 'password_reset')"),
        locale: z.string().optional().describe("Locale code (e.g. 'en', 'pt_BR')"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) =>
      safeHandler(() => client.get("/super_admin/whitelabel/email_template", params)),
  );

  // ── AI configuration ──────────────────────────────────────────────────────
  server.registerTool(
    "test_whitelabel_ai_connection",
    {
      title: "Test AI provider connection",
      description: `Validate an AI provider API key by issuing a probe request. Auto-detects provider from key shape. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        api_key: z.string().min(1).describe("Provider API key (OpenAI, Anthropic, etc.)"),
        model: z.string().optional().describe("Model identifier to probe with"),
      },
    },
    async (body) =>
      safeHandler(() => client.post("/super_admin/whitelabel/test_ai_connection", body)),
  );

  server.registerTool(
    "update_whitelabel_ai_config",
    {
      title: "Update active AI provider config",
      description: `Persist (or update) the whitelabel AI provider key + model used by Captain AI hooks and the script chat agent. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        api_key: z.string().min(1),
        model: z.string().min(1).describe("Model identifier (e.g. 'gpt-4o', 'claude-sonnet-4')"),
      },
    },
    async (body) =>
      safeHandler(() => client.post("/super_admin/whitelabel/update_ai_config", body)),
  );

  server.registerTool(
    "activate_whitelabel_credential",
    {
      title: "Activate a stored AI credential",
      description: `Switch the active AI provider to a previously stored credential. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        provider: z.string().min(1).describe("Provider key (e.g. 'openai', 'anthropic', 'google')"),
      },
    },
    async (body) =>
      safeHandler(() => client.post("/super_admin/whitelabel/activate_credential", body)),
  );

  server.registerTool(
    "delete_whitelabel_credential",
    {
      title: "Delete a stored AI credential",
      description: `Remove a stored provider credential. Cannot delete the currently active one — activate another first. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        provider: z.string().min(1),
      },
      annotations: { destructiveHint: true },
    },
    async ({ provider }) =>
      safeHandler(() => client.delete("/super_admin/whitelabel/delete_credential", { provider })),
  );

  server.registerTool(
    "migrate_whitelabel_credentials",
    {
      title: "Migrate legacy credentials to new schema",
      description: `One-shot migration of credentials stored in the legacy InstallationConfig keys into the new WhitelabelCredential model. Idempotent. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {},
      annotations: { idempotentHint: true },
    },
    async () => safeHandler(() => client.post("/super_admin/whitelabel/migrate_credentials")),
  );

  // ── Custom scripts (chat-AI assisted) ─────────────────────────────────────
  server.registerTool(
    "analyze_whitelabel_script",
    {
      title: "Run AI security audit on a custom dashboard script",
      description: `Submit a JS snippet that would run in the dashboard and receive a structured security/UX/performance audit. Cached 1h by SHA256 of the content. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        script_content: z.string().min(1).describe("Raw JavaScript source to be analyzed"),
      },
    },
    async (body) => safeHandler(() => client.post("/super_admin/whitelabel/analyze_script", body)),
  );

  server.registerTool(
    "whitelabel_script_chat",
    {
      title: "Send a message to the script-authoring AI agent",
      description: `Conversational AI flow that helps draft/refine custom dashboard scripts. Maintains a per-super_admin conversation thread. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        message: z.string().min(1).describe("User message to the agent"),
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Free-form context object (current script, selection, intent)"),
      },
    },
    async (body) => safeHandler(() => client.post("/super_admin/whitelabel/chat", body)),
  );

  // ── Branding (logo) ───────────────────────────────────────────────────────
  server.registerTool(
    "delete_whitelabel_logo",
    {
      title: "Delete a whitelabel logo asset",
      description: `Remove a stored branding asset by type (e.g. 'logo', 'logo_dark', 'favicon'). ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        type: z.string().min(1).describe("Logo asset type — 'logo', 'logo_dark', 'favicon', etc."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ type }) =>
      safeHandler(() => client.delete("/super_admin/whitelabel/delete_logo", { type })),
  );

  // upload_whitelabel_logo intentionally omitted: the controller requires a
  // multipart `params[:logo]` File upload and NooviChatClient only ships
  // JSON bodies. Operators that need MCP-driven uploads should add a thin
  // bridge service that accepts { type, source_url }, fetches the URL and
  // re-POSTs the binary as multipart. Once that bridge exists, register a
  // tool here named `upload_whitelabel_logo` with { type, source_url }.

  // ── Email templates ───────────────────────────────────────────────────────
  server.registerTool(
    "save_whitelabel_email_template",
    {
      title: "Save (create/update) a whitelabel email template",
      description: `Persist a custom HTML/text body for a named transactional email template. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        name: z.string().min(1),
        body: z.string().min(1).describe("Template body (Liquid/HTML)"),
        locale: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async (body) => safeHandler(() => client.post("/super_admin/whitelabel/email_template", body)),
  );

  server.registerTool(
    "delete_whitelabel_email_template",
    {
      title: "Reset a whitelabel email template to default",
      description: `Delete the custom override for a named template, falling back to the built-in default. ${SUPER_ADMIN_AUTH_NOTE}`,
      inputSchema: {
        name: z.string().min(1),
      },
      annotations: { destructiveHint: true },
    },
    async ({ name }) =>
      safeHandler(() => client.delete("/super_admin/whitelabel/email_template", { name })),
  );
};
