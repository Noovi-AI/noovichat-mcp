# NooviChat-MCP — Architecture

## High-level

```
┌────────────────────────┐    stdio JSON-RPC    ┌─────────────────────┐
│ MCP host (Claude       │ ──────────────────► │  NooviChat-MCP      │
│ Desktop / Code / Cursor│ ◄────────────────── │  (Node 20 + TS)     │
│ / VS Code Continue)    │                      │                     │
└────────────────────────┘                      └──────────┬──────────┘
                                                           │
                                              REST + api_access_token header
                                                           │
                                                           ▼
                                                ┌─────────────────────┐
                                                │  NooviChat instance │
                                                │  (Rails 7.1)        │
                                                └─────────────────────┘
```

## Layered design

```
src/
├── index.ts            ← entrypoint: env validation + stdio wiring
├── server.ts           ← McpServer factory; calls registerAllTools
├── client.ts           ← NooviChatClient: HTTP + auth + errors
├── config.ts           ← package.json metadata loader
├── types.ts            ← RegisterFn type
└── tools/
    ├── index.ts        ← aggregator: imports + iterates 22 modules
    ├── _helpers.ts     ← shared zod fragments, safeHandler, resolveAccountId
    ├── pipelines.ts
    ├── pipeline-cards.ts
    ├── pipeline-automations.ts
    ├── pipeline-activities.ts
    ├── pipeline-sequences.ts
    ├── pipeline-webhooks.ts
    ├── follow-ups.ts
    ├── appointments.ts
    ├── broadcasts.ts
    ├── whatsapp-templates.ts
    ├── waha.ts
    ├── uazapi.ts
    ├── lead-scoring.ts
    ├── companies.ts
    ├── internal-chat.ts
    ├── atendimento-extensions.ts
    ├── google-calendar.ts
    ├── noovi-license.ts
    ├── noovi-labs.ts
    ├── whitelabel.ts
    ├── captain-hook.ts
    └── audio.ts
```

## Boundaries

| Layer | Responsibility | Doesn't do |
|---|---|---|
| `index.ts` | Env validation, fail-fast, transport wiring | Business logic, retries, logging |
| `server.ts` | McpServer construction, capability declaration | Tool implementation |
| `client.ts` | HTTP requests, auth header, URL composition, error parsing | Caching, retries, schema validation |
| `tools/_helpers.ts` | Shared zod, safeHandler, account ID fallback | API calls, business logic |
| `tools/<resource>.ts` | Tool registration with zod schema + handler | Multi-step orchestration |

## Cross-cutting concerns

### Authentication

All NooviChat API calls send `api_access_token: <token>` HTTP header. There's
no `Authorization: Bearer` — NooviChat (and Chatwoot upstream) use a custom
header. The token is read once from env and cached in the client instance.

### Error model

```
NooviChatApiError
  ├── status:  number      (HTTP status; 0 if network failure)
  ├── errors:  string[]    (parsed from response body)
  ├── path:    string      (request path for debugging)
  └── message: string      (first error or status text)
```

Caught by `safeHandler` → surfaced as `{ error: true, ... }` JSON in MCP
output. Other thrown errors bubble (they're real bugs).

### Account scoping

`NOOVICHAT_ACCOUNT_ID` env var provides a default. Tools accept
`optionalAccountId` and call `resolveAccountId(input?)` which prefers explicit
input → falls back to env → throws if neither is set.

Destructive operations (`delete_*`, `permanently_delete_*`, `bulk_delete_*`,
`lgpd_delete_*`) require `accountId` (mandatory) — no env fallback. This
forces the LLM to spell out the target account when doing irreversible work.

## Cross-project sync

This server consumes the same API surface as:
- NooviChat dashboard (Vue.js, in-app)
- `@nooviai/n8n-nodes-noovichat` (n8n community node)

When the Rails API changes:
- A new endpoint → optionally new tool here
- A renamed endpoint → mandatory update here (and in n8n node)
- A removed endpoint → tool deprecated here

The same checklist as `Chatwoot/docs/rules/n8n-sync.md` applies. Until a
parallel `mcp-sync.md` is written in the Chatwoot repo, treat n8n-sync.md as
authoritative for both consumers.

## Distribution

- `npm publish --access public` to `@nooviai/noovichat-mcp`
- Clients invoke via `npx -y @nooviai/noovichat-mcp` (no global install
  needed — npm caches recent versions)
- New version takes effect on next MCP host restart (or per-session for
  hosts that spawn fresh per chat)

## Why stdio (and only stdio)

MCP supports stdio, SSE, and HTTP. We use **only** stdio because:
1. Standard transport for desktop MCP hosts (Claude Desktop, Code, Cursor)
2. No need to host a server — the host spawns us as a child process
3. Auth is implicit (the host manages env vars and process isolation)
4. SSE/HTTP would require deploy infra we don't need yet

Adding SSE/HTTP later is a non-breaking addition — the SDK supports both
transports on the same `McpServer` instance.
