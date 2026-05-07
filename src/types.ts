import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NooviChatClient } from "./client.js";

/**
 * Signature implemented by every tool module. Each module exports
 * `register: RegisterFn` — the aggregator iterates and calls them.
 */
export type RegisterFn = (server: McpServer, client: NooviChatClient) => void;

/**
 * Common error shape returned to MCP clients.
 */
export interface NooviChatErrorPayload {
  status: number;
  errors: string[];
  message: string;
}
