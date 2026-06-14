@AGENTS.md

# NooviChat-MCP — Project instructions for Claude

> When developed inside the NooviChat monorepo, this is a subproject —
> read the root `CLAUDE.md` first. As a standalone public repo, this
> file is the single source of truth for project conventions.

## What this project is

A [Model Context Protocol](https://modelcontextprotocol.io/) server (TypeScript
+ Node 20+) that wraps the NooviChat REST API and exposes a broad tool catalog to MCP
hosts (Claude Desktop / Claude Code / Cursor / VS Code).

It's a thin HTTP wrapper — **all business logic lives in the NooviChat Rails
app**. This package only translates between MCP tool calls and REST calls.

## ⛔ Implementation loop (MANDATORY — run via `/loop` for any non-trivial 3+ step task)

`plan/recon → implement → review → test → upstream-API sync → (commit) → repeat` until nothing left to apply/adjust/polish — then **close the cycle by updating the Obsidian docs**. Single-shot answers to implementation requests are a bug.

1. **Recon** — map before editing; read `docs/rules/architecture.md` and the existing `src/tools/<resource>.ts` you are touching. Synthesize a root-cause diagnosis.
2. **Implement** — match surrounding style: one resource per `src/tools/*.ts` with a `register: RegisterFn`, zod input schemas, JDoc route paths, aggregator in `src/tools/index.ts`. Reference `src/tools/pipeline-cards.ts`. Minimal cohesive change per iteration.
3. **Review (fail-closed gate)** before commit: `pnpm check` (typecheck + lint via Biome + vitest), 0 errors.
4. **Test** — MCP stdio smoke: build (`pnpm build`) and exercise the changed tool against a real NooviChat instance (or via the MCP host).
5. **Upstream-API sync analysis (MANDATORY for every fix AND feature)** — this server consumes the Chatwoot REST API. Did the Chatwoot API change (or did you change a tool's route/schema that must match it)? Cross-check the Chatwoot side `../Chatwoot/docs/rules/mcp-sync.md`. A route change → bump minor here AND in the n8n node the same day. If nothing API-facing changed, say so explicitly. Never skip the question.
6. **Atomic commit** — Conventional Commits, one logical unit. `pnpm version` bump when releasing.
7. **⛔ Close the cycle — update internal docs (`/doc-obsidian`) — MANDATORY, NEVER skip.** Update canonical technical docs according to the private documentation process for anything that changed (tools, resources, API mirroring). If nothing documentable changed, state that and skip — but always ask.

**`pnpm publish` is NOT part of the loop** — run `/pre-publish-audit` first; it needs human approval + golden rules (gated by the root pre-deploy-gate hook). The Obsidian doc update (step 7) IS part of the loop and closes it.

### Mandatory tests (even in MVP)

MVP philosophy allows skipping tests for speed — but tests are REQUIRED, no exception, for:
1. **New tool / changed route or schema** — any `src/tools/*.ts` add/change → vitest that the tool registers and hits the correct route with the right params (api-sync).
2. **Account scoping** — any handler using `resolveAccountId`/`accountId` → test that destructive tools require an explicit `accountId` and reads fall back to env.
3. **Destructive annotations** — any tool marked `destructiveHint` (delete/cancel/permanent) → test it is annotated correctly.
4. **Error handling** — any change to `safeHandler`/`_helpers` → test the `{error,status,path,errors}` shape.
5. **Bug-report fixes** — any fix from a reported broken tool → regression test in the same commit.

When in doubt, add the test. A published broken version cannot be removed and breaks every MCP host on next session.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 20+ (uses native `fetch`) |
| Lang | TypeScript 5 strict |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Transport | stdio (MCP standard) |
| HTTP | native `fetch` + `AbortController` (no axios) |
| Validation | Zod (inline per tool) |
| Build | `tsup` → `dist/index.js` (ESM) |
| Test | `vitest` |
| Lint/Format | Biome (single tool replacing eslint+prettier) |

## Code conventions

### Tool file pattern

Every tool module lives under `src/tools/<resource>.ts` and exports a single
function `register: RegisterFn`:

```typescript
import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { optionalAccountId, resolveAccountId, safeHandler } from "./_helpers.js";

export const register: RegisterFn = (server, client) => {
  server.registerTool(
    "tool_name",
    {
      title: "Human-readable title",
      description: "What the tool does, in one sentence.",
      inputSchema: { account_id: optionalAccountId, /* ... */ },
      annotations: { readOnlyHint: true }, // or idempotentHint / destructiveHint
    },
    async ({ account_id, ...body }) =>
      safeHandler(() => {
        const acc = resolveAccountId(account_id);
        return client.get(`/api/v1/accounts/${acc}/...`);
      }),
  );
};
```

The reference implementation is `src/tools/pipeline-cards.ts` — copy its
style for any new tool.

### Naming

- **Tool names**: `<verb>_<resource>` snake_case, no leading underscore.
  Examples: `list_pipelines`, `move_card_to_stage`, `bulk_assign_cards`.
- **Files**: `kebab-case.ts` (e.g., `pipeline-cards.ts`, `whatsapp-templates.ts`).
- **Schemas**: top-of-file `const fooId = z.number()...` for reuse within the file.

### Annotations

Set the right hint on every tool:

| Hint | When |
|---|---|
| `readOnlyHint: true` | All GET requests |
| `idempotentHint: true` | PATCH / PUT (re-running is safe) |
| `destructiveHint: true` | DELETE, `permanently_delete`, `cancel`, anything irreversible |

### Response format

Always `safeHandler(() => client.METHOD(...))` — never manually wrap with
`jsonText`. `safeHandler` handles the SDK's required `{ content: [{ type:
"text", text }] }` shape AND turns `NooviChatApiError` into a structured
error payload that surfaces nicely in Claude.

### Account scoping

Every NooviChat API call is account-scoped. Two valid patterns:

1. **`accountId` (required)** — for destructive actions. The user must pass
   it explicitly.
2. **`optionalAccountId`** — for read/CRUD; falls back to
   `NOOVICHAT_ACCOUNT_ID` env via `resolveAccountId(account_id)`.

Use `optionalAccountId` by default; reserve `accountId` for irreversible
operations (`delete_pipeline`, `permanently_delete_card`,
`bulk_delete_cards`, `lgpd_delete_contact`).

### Error handling

`NooviChatApiError` carries `status`, `errors[]`, `path`. `safeHandler`
catches it and returns:

```json
{
  "error": true,
  "status": 422,
  "path": "/api/v1/accounts/1/pipeline_cards",
  "message": "Title can't be blank",
  "errors": ["Title can't be blank"]
}
```

Other errors bubble — let them.

## Sync with the NooviChat backend (CRITICAL)

This MCP server is a **third consumer** of the NooviChat REST API, alongside:
- The Vue.js dashboard (in-app)
- `@nooviai/n8n-nodes-noovichat` (n8n node)

When the API changes upstream, **all three must be updated**.

> **Mandatory** — when any of these change in the NooviChat Rails app:
> - `app/controllers/api/v1/accounts/*.rb`
> - `config/routes.rb`
>
> ...check this MCP for impact. The `mcp-sync` checklist mirrors the
> existing `n8n-sync` one — same flow, different consumer.

If a backend route changed:
1. Update the matching tool file here
2. Bump the package minor version (e.g., `0.1.0` → `0.2.0`) for new tools, or
   major version for breaking signature changes
3. Publish via `pnpm publish` from a clean working tree (Regra de Ouro 1)
4. Restart MCP hosts (they spawn `npx -y @nooviai/noovichat-mcp` per session)

## Deploy / publish

`npm publish` is a deploy gate (see root `docs/rules/deploy-safety.md`).
Once published, every client that runs `npx -y @nooviai/noovichat-mcp`
gets it on next invocation. **Never publish during business hours BR** (Seg-Sex 08-19h BRT).

```bash
# Bump version
pnpm version patch # or minor / major

# Build + check (runs typecheck + lint + tests)
pnpm prepublishOnly

# Publish
pnpm publish --access public
```

The `prepublishOnly` script enforces:
- Build succeeds
- `tsc --noEmit` passes
- Biome lint passes
- Vitest passes

## Multi-tenant safety

This server is just a wrapper — multi-tenant isolation is enforced **server-side**
in NooviChat. But:

- **Never trust** an `account_id` parameter to access another account's data —
  the API token used is scoped to its accounts. NooviChat will return 401/404
  if the token doesn't have access. We surface that error as-is.
- **Never log full request bodies** — they may contain customer PII. Logging
  is opt-in only (the SDK's `logging` capability is declared but not used yet).

## Adding a new feature module

1. Identify whether it's a **new resource** (new file) or **new tool on
   existing resource** (edit existing file).
2. Find the matching Rails route in `Chatwoot/config/routes.rb`.
3. Write the tool following `pipeline-cards.ts`. Use shared helpers.
4. If new file: add import + entry to `src/tools/index.ts`.
5. Add a unit test in `tests/tools/<resource>.test.ts`:
   - Asserts tool is registered
   - Asserts schema includes the expected fields
   - Asserts handler builds the right URL (mock `client`)
6. Run `pnpm check`.
7. Update README's "Features exposed" table.
8. Bump version + publish (during deploy window).

## Common pitfalls

- **Don't import from `dist/`** — only from `src/`. tsup handles the rewrite.
- **Don't hardcode account IDs** in code — use `resolveAccountId(account_id)`.
- **Don't forget the `.js` extension** in imports — TS strict ESM requires it
  (this is Node ESM, not bundler).
- **Don't add a default export** to tool files — only named `register`.
- **`account_id` in schema must be `optionalAccountId`** for non-destructive,
  `accountId` (required) for destructive.

## Reference docs

- Pattern: `src/tools/pipeline-cards.ts`
- Helpers: `src/tools/_helpers.ts`
- Client: `src/client.ts`

## Related

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP specification](https://spec.modelcontextprotocol.io/)
- [`@nooviai/n8n-nodes-noovichat`](https://www.npmjs.com/package/@nooviai/n8n-nodes-noovichat) — sister project (n8n consumer of the same API)
