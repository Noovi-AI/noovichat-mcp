import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NooviChatClient } from "./client.js";
import config from "./config.js";
import { registerAllTools } from "./tools/index.js";

/**
 * Server-level instructions — surfaced to the LLM at connection time so it
 * understands how to drive this MCP without trial and error.
 */
const SERVER_INSTRUCTIONS = `
NooviChat MCP — customer-engagement platform built on Chatwoot, with custom
modules: Pipeline Pro (CRM), Follow-Ups, Broadcasts (disparador), WhatsApp
Templates, Lead Scoring, Appointments and Captain AI.

Conventions:
- Almost every tool is account-scoped. Pass account_id, or set the
  NOOVICHAT_ACCOUNT_ID env var and it is used by default.
- IDs are numbers. Conversation IDs are per-account display IDs, not UUIDs.
- Errors come back as JSON { error: true, status, message, errors[] }. Read
  the message — validation errors name the offending field.
- List tools are read-only; create/update/delete mutate. Prefer dry-run
  variants (e.g. dry_run_automation) before execute.

Pipeline automations & cross-features:
- Automations react to triggers (conversation/contact/pipeline events) and run
  actions across features (move card, send message/WhatsApp, add label, assign
  agent, Captain AI, Google Calendar, webhooks...).
- Workflow: call get_automation_catalog to discover valid triggers/conditions/
  actions, then build_automation_flow to assemble a valid flow, then pass that
  flow to create_pipeline_automation with trigger_type 'event'.
`.trim();

export function createServer(client: NooviChatClient): McpServer {
  const server = new McpServer(
    {
      name: config.packageInfo.name,
      version: config.packageInfo.version,
    },
    {
      capabilities: {
        logging: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerAllTools(server, client);

  return server;
}
