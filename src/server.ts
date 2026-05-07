import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NooviChatClient } from "./client.js";
import config from "./config.js";
import { registerAllTools } from "./tools/index.js";

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
    },
  );

  registerAllTools(server, client);

  return server;
}
