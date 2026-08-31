# @nooviai/noovichat-mcp

> **Model Context Protocol server for [NooviChat](https://noovichat.com)** —
> exposes Pipeline Pro, Follow-Ups, Atendimentos, Broadcasts, WhatsApp Templates,
> WAHA/UAZAPI integrations and other custom NooviChat features as tools that
> Claude Desktop, Claude Code, Cursor and VS Code can call.

[![npm version](https://img.shields.io/npm/v/@nooviai/noovichat-mcp.svg)](https://www.npmjs.com/package/@nooviai/noovichat-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is this?

NooviChat-MCP is an [MCP](https://modelcontextprotocol.io/) server that lets
LLM-powered assistants (Claude, Cursor, etc.) interact with your NooviChat
instance using natural language. Ask Claude to "move card #42 to the
Negotiation stage" or "list all follow-ups scheduled for tomorrow" and the
model uses these tools to get it done.

The server wraps the NooviChat REST API and exposes the NooviChat feature
modules: Pipeline Pro, follow-ups, appointments, broadcasts, WhatsApp
(WAHA / UAZAPI / Hub), Captain AI, lead scoring, companies, internal chat
and related extras. It does **not** expose core helpdesk CRUD
(conversations, contacts, messages, inboxes, teams, v1/v2 reports). For
those, use [`@nooviai/n8n-nodes-noovichat`](https://www.npmjs.com/package/@nooviai/n8n-nodes-noovichat)
or the REST API.

**Dual path**

| Precisa… | Superfície |
|---|---|
| Pipeline, follow-up, WhatsApp, agenda, broadcast, Captain, companies, chat interno | este MCP |
| Descobrir contas do token | `get_profile` |
| CRUD de conversa / contato / mensagem / inbox / agente / time | n8n + REST |
| Campaign clássica e SLA | n8n (o MCP **não** tem esses recursos) |

Operator skills with the real tool names: public plugin
[`Noovi-AI/noovichat-skills`](https://github.com/Noovi-AI/noovichat-skills).
Do not invent names like `conversations_list` — they are not registered here.

## Features exposed

Counts change when `registerTool` calls are added. Do not copy a frozen total
from an old README. Live inventory: `src/tools/*.ts`, the skills snapshot
`scripts/tools.snapshot.json` in `NooviChat-Skills`, or `tools/list` on a
running server.

| Area | Highlights |
|---|---|
| **Profile** | Token identity + account memberships (`get_profile`) |
| **Pipeline Pro** | Funnels, stages, cards CRUD, move/win/lost, bulk, GDPR restore |
| **Pipeline automations** | CRUD, execute, dry-run, validate, audit logs, templates |
| **Pipeline activities / sequences / webhooks** | Activities, card cadences, outbound webhooks |
| **Follow-Ups** | Schedule, cancel, templates, automations, reports |
| **Atendimentos** | Appointments, services, professionals, availability, Google Calendar |
| **Broadcasts** | Mass-send, blacklist, pause/resume |
| **WhatsApp** | Hub (NooviConnect), Meta templates, WAHA, UAZAPI |
| **Lead scoring / companies** | Rules, dashboard, B2B company CRUD+search |
| **Internal chat** | Agent-to-agent DMs and groups (not customer conversations) |
| **Atendimento extensions** | LGPD, bulk update, consent, forwards, merge — **not** conversation list |
| **Captain AI hook** | Preferences + rewrite / summarize / reply / label / follow-up |
| **Whitelabel** | `super_admin` only — not for routine operator use |

## Install

The server is invoked by your MCP host (Claude Desktop, Cursor, etc.) as a
subprocess via `npx`. You don't run it manually.

### Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) — or your
Claude Code settings:

```json
{
  "mcpServers": {
    "noovichat": {
      "command": "npx",
      "args": ["-y", "@nooviai/noovichat-mcp"],
      "env": {
        "NOOVICHAT_BASE_URL": "https://chat.example.com",
        "NOOVICHAT_API_TOKEN": "your-api-token-here",
        "NOOVICHAT_ACCOUNT_ID": "1"
      }
    }
  }
}
```

Restart the MCP host. The NooviChat MCP tools become available to the model.

Copy [`.mcp.json.example`](.mcp.json.example) in a project that uses Claude Code,
Cursor or VS Code. The npm pack includes that file (`files` in `package.json`).

### Cursor

Project file `.cursor/mcp.json` (or Cursor Settings → MCP). Same `mcpServers`
shape as Claude:

```json
{
  "mcpServers": {
    "noovichat": {
      "command": "npx",
      "args": ["-y", "@nooviai/noovichat-mcp"],
      "env": {
        "NOOVICHAT_BASE_URL": "https://chat.example.com",
        "NOOVICHAT_API_TOKEN": "your-api-token-here",
        "NOOVICHAT_ACCOUNT_ID": "1"
      }
    }
  }
}
```

### VS Code

Workspace file `.vscode/mcp.json` (VS Code 1.99+). The key is `servers`, not
`mcpServers`:

```json
{
  "servers": {
    "noovichat": {
      "command": "npx",
      "args": ["-y", "@nooviai/noovichat-mcp"],
      "env": {
        "NOOVICHAT_BASE_URL": "https://chat.example.com",
        "NOOVICHAT_API_TOKEN": "your-api-token-here",
        "NOOVICHAT_ACCOUNT_ID": "1"
      }
    }
  }
}
```

Ask the model to call `get_profile` once if you are unsure of `NOOVICHAT_ACCOUNT_ID`.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `NOOVICHAT_BASE_URL` | yes | NooviChat instance URL (e.g., `https://chat.example.com`). No trailing slash. |
| `NOOVICHAT_API_TOKEN` | yes | API access token from NooviChat → Profile → API Access. Belongs to a real agent — its permissions are the ceiling of what the MCP can do. |
| `NOOVICHAT_ACCOUNT_ID` | optional | Default account ID. If set, you can omit `account_id` from individual tool calls. Required for single-tenant setups; multi-account operators may want to leave it unset and pass per-call. |
| `NOOVICHAT_TIMEOUT_MS` | optional | HTTP request timeout in milliseconds (default `30000`). |

### Getting an API token

1. Log into your NooviChat instance as an admin or agent
2. Profile menu → **API Access**
3. Copy the token shown
4. Token inherits the agent's role and account membership — keep it scoped to
   what you need (don't use a super_admin token for routine LLM operations)

## Usage examples

Ask Claude things like:

> "List my urgent open pipeline cards in the **B2B Outbound** funnel that are
> assigned to me."

> "Schedule a WhatsApp follow-up to contact #1234 saying 'Hi {{name}}, did
> you receive our proposal?' for 9am tomorrow."

> "Move card #42 to the **Won** stage with value R$15,000 and note 'closed
> via discount + early payment'."

> "Show me the conversion rate from **Discovery** to **Demo** stage in the
> last 30 days."

The model picks the right tools, fills the parameters, and calls them.

## Available tools

The inventory is generated from the source during release. To browse tools grouped by feature area, look at
[`src/tools/`](src/tools/) — each file is one resource.

## Development

```bash
# Install
pnpm install

# Type-check + lint + test
pnpm check

# Watch mode for local dev
pnpm dev

# Run the server pointing at a real NooviChat instance
NOOVICHAT_BASE_URL=https://chat.example.com \
NOOVICHAT_API_TOKEN=xxx \
NOOVICHAT_ACCOUNT_ID=1 \
pnpm start
```

### Testing locally with Claude Desktop

In your Claude Desktop config, point at the local build:

```json
{
  "mcpServers": {
    "noovichat-dev": {
      "command": "node",
      "args": ["/absolute/path/to/NooviChat-MCP/dist/index.js"],
      "env": { "NOOVICHAT_BASE_URL": "...", "NOOVICHAT_API_TOKEN": "..." }
    }
  }
}
```

### Adding a new tool

1. Identify the resource (e.g., a new `pipeline_widget` route).
2. Create or edit the file in `src/tools/<resource>.ts`.
3. Follow the pattern in `pipeline-cards.ts` — `server.registerTool(name,
   { title, description, inputSchema, annotations? }, handler)`.
4. Always wrap handlers in `safeHandler(() => client.METHOD(...))` from
   `_helpers.ts`. Don't manually JSON-stringify.
5. If it's a new resource file, add the import + entry to
   `src/tools/index.ts`.
6. Add a test asserting registration.

## Architecture

```
┌────────────────────────┐    stdio     ┌─────────────────────┐
│ Claude Desktop / Code  │ ◄──────────► │  noovichat-mcp      │
│ Cursor / VS Code (MCP) │              │  (this package)     │
└────────────────────────┘              └──────────┬──────────┘
                                                   │
                                              REST + api_access_token
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │  NooviChat instance │
                                        │  (Rails 7.1 + Vue)  │
                                        └─────────────────────┘
```

- **Transport:** stdio (the standard MCP Desktop / Code / Cursor transport)
- **Auth:** `api_access_token` HTTP header (NooviChat / Chatwoot REST contract)
- **Validation:** [Zod](https://zod.dev) schemas inline per tool
- **HTTP:** native Node 20+ `fetch` with `AbortController` timeout
- **SDK:** [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)

## Releases

This package follows [semver](https://semver.org/):

- **Patch** (0.1.x): bug fixes, doc updates, internal refactors
- **Minor** (0.x.0): new tools, new resources
- **Major** (x.0.0): breaking changes to existing tool signatures

Releases respect the NooviChat monorepo
[release-cadence rule](../docs/rules/release-cadence.md): batched, versioned
opt-in. Clean tree and HEAD-pushed (G1/G2) are mandatory; the Chatwoot
business-hours window (G3) does **not** apply to this package.

## License

[MIT](LICENSE) — Copyright (c) 2026 Noovi.

## Related Noovi projects

- [`@nooviai/n8n-nodes-noovichat`](https://www.npmjs.com/package/@nooviai/n8n-nodes-noovichat)
  — n8n community node (REST consumer; includes conversation/contact/message CRUD)
- Operator skills plugin: public `NooviChat-Skills` (Claude / Cursor / Codex)
- [NooviChat](https://noovichat.com) — the platform itself

## Support

- **Issues:** https://github.com/Noovi-AI/noovichat-mcp/issues
- **Docs:** https://noovichat.com/docs
- **Email:** contato@nooviai.com
