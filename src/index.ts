import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NooviChatClient } from "./client.js";
import { createServer } from "./server.js";

const baseUrl = process.env.NOOVICHAT_BASE_URL;
const apiToken = process.env.NOOVICHAT_API_TOKEN;
const timeoutMs = process.env.NOOVICHAT_TIMEOUT_MS
  ? Number(process.env.NOOVICHAT_TIMEOUT_MS)
  : undefined;

if (!baseUrl) {
  console.error("NOOVICHAT_BASE_URL environment variable is required");
  process.exit(1);
}
if (!apiToken) {
  console.error("NOOVICHAT_API_TOKEN environment variable is required");
  process.exit(1);
}
if (timeoutMs !== undefined && (Number.isNaN(timeoutMs) || timeoutMs <= 0)) {
  console.error("NOOVICHAT_TIMEOUT_MS must be a positive number");
  process.exit(1);
}

const client = new NooviChatClient({ baseUrl, apiToken, timeoutMs });
const server = createServer(client);
const transport = new StdioServerTransport();

await server.connect(transport);
