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

The server wraps the NooviChat REST API and exposes a broad tool catalog across
the NooviChat feature modules — every customization the NooviChat platform adds on
top of Chatwoot, plus the most useful Chatwoot-native operations needed
for them to work end-to-end.

## Features exposed

| Area | Tools | Highlights |
|---|---|---|
| **Pipeline Pro — core** | 32 | Funnels, stages, cards CRUD, move/win/lost, bulk, GDPR restore, additional (non-primary) contacts/conversations |
| **Pipeline automations** | 24 | CRUD, execute, dry-run, validate, audit logs, executions, templates |
| **Pipeline activities** | 27 | Activities CRUD, sequences, templates, status transitions |
| **Pipeline sequences** | 8 | Card-attached cadences, account-scoped external start, 1–90 day analytics summary |
| **Pipeline webhooks** | 9 | Outbound delivery CRUD/test/secret rotation + separate public automation trigger/verify |
| **Follow-Ups** | 24 | Schedule, cancel, templates, items, variables, automations, reports |
| **Atendimentos** | 31 | Appointments, services, professionals, partners, availability (single day and range), Google Calendar sync |
| **Broadcasts** | 14 | Mass-send WhatsApp campaigns (CSV/tags/kanban/whatsapp_group), blacklist, pause/resume, duplicate |
| **WhatsApp Hub (NooviConnect)** | 28 | Sessions, groups & channels, hub report, create/leave group, participants (add/remove/promote/demote), group settings (name/topic/photo/locked/announce), invite link, join/preview group by link, group picture, unfollow channel, send poll/location, profile (read/status), check number, WhatsApp Business labels |
| **WhatsApp Templates** | 6 | Custom CRUD over Meta Cloud + sync from Meta |
| **WAHA** | 14 | Self-hosted WhatsApp gateway: status, QR, pairing, sessions, settings, sync |
| **UAZAPI** | 8 | Alternative WhatsApp gateway: status, settings, connect/disconnect, pairing |
| **Lead Scoring** | 15 | Rules, logs, dashboard, distribution, trends, top leads, bulk recalc |
| **Internal Chat** | 14 | Agent-to-agent DMs, groups, members, messages CRUD, mark read |
| **Companies** | 6 | B2B grouping, search, CRUD |
| **Atendimento ext.** | 12 | LGPD delete/export, bulk update, consent records, forwards, merge, history |
| **Google Calendar** | 8 | Sync to/from, bulk sync, toggle, status, circuit breaker controls |
| **Captain AI hook** | 7 | Preferences + 5 synchronous AI tasks (rewrite, summarize, reply, label, follow-up) |
| **Whitelabel (super_admin)** | 16 | Branding, AI providers, scripts, audit logs, backups |
| **NooviLabs / Audio** | 0 (today) | No public API today; implementation notes stay out of roadmap source |
| **Total** | Generated from source | Count tool registrations during release instead of hardcoding a number |

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

### Cursor / VS Code (Continue)

Same pattern — point the MCP config at this package via `npx`. See your
host's MCP documentation for the exact format.

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
[release-cadence rule](../docs/rules/release-cadence.md): batched, never
during business hours BR (Mon-Fri 08-19h BRT).

## License

[MIT](LICENSE) — Copyright (c) 2026 Noovi.

This project is forked from [`fazer-ai/mcp-chatwoot`](https://github.com/fazer-ai/mcp-chatwoot)
under MIT. The original copyright notice is preserved in [LICENSE](LICENSE).

## Related Noovi projects

- [`@nooviai/n8n-nodes-noovichat`](https://www.npmjs.com/package/@nooviai/n8n-nodes-noovichat)
  — n8n community node (REST consumer, similar surface)
- [NooviChat](https://noovichat.com) — the platform itself

## Support

- **Issues:** https://github.com/Noovi-AI/noovichat-mcp/issues
- **Docs:** https://noovichat.com/docs
- **Email:** contato@nooviai.com
