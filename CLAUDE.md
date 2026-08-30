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

> Canonical methodology (the *why*, the Codex↔Claude split, the four-surface contract fan-out): `../docs/rules/loop-engineering.md`. This section is the MCP-specific instantiation of that loop — adapted to a TypeScript MCP server that is a **downstream consumer** of the Chatwoot REST API.

`recon → implement → review → tool↔route parity → real-behavior test → contract sync → commit → close-the-cycle docs → repeat` until nothing left to apply/adjust/polish. Single-shot answers to implementation requests are a bug.

**⚙️ Autonomy contract — this loop runs end-to-end WITHOUT a human in the loop.** Every step, **including the atomic commit (step 7) and the internal-docs close (step 8)**, is the agent's to perform autonomously — never pause to ask "can I commit?". The **ONLY** hard block is **production release**: `pnpm version <patch|minor|major>` + `pnpm publish --access public` (and the `git push --follow-tags` that carries the tag). Publishing is a **versioned opt-in**: once on npm a version cannot be removed, so a broken publish breaks every MCP host (Claude Desktop/Code/Cursor) on next session. Those release actions always need explicit human approval + the 5 golden rules + `/pre-publish-audit`. Everything up to and including committing to `main` is autonomous. If a gate fails, fix it and re-loop — never hand a half-done cycle back.

**⚡ Fast path (trivial change — skip the heavy gates).** A change is *trivial* only when it is **≤2 files AND touches none of**: a tool's name/zod schema/route, a destructive annotation, `_helpers.ts`/`client.ts`, account-scoping (`accountId`/`resolveAccountId`), or the `src/tools/index.ts` registry. Examples: a tool description/JDoc fix, a comment, a `biome.json`/config tweak, a one-line bugfix with an obvious cause. Trivial changes go straight to **review (`pnpm check`) → commit**; steps 4–6 (parity, real-behavior test, contract sync) and step 8 (docs) are N/A by definition — say so in one line and move on. **Anything else** (3+ steps, or *any* tool/schema/route/destructive/account-scoping touch even in a single file) runs the full loop. When unsure, run the full loop.

1. **Recon** — map before editing; read `docs/rules/architecture.md` and the existing `src/tools/<resource>.ts` you are touching. **Reuse-first** (see "Native cohesion" below): before adding a new tool file, helper, or zod fragment, find the existing one and **extend** it. Synthesize a root-cause diagnosis.
2. **Implement** — match surrounding style: one resource per `src/tools/*.ts` with a single `register: RegisterFn`, zod input schemas, JDoc route paths, aggregator entry in `src/tools/index.ts`. Reference `src/tools/pipeline-cards.ts`. Minimal cohesive change per iteration. Reuse `_helpers.ts` (`safeHandler`, `resolveAccountId`, `optionalAccountId`/`accountId`, `pagination`, shared id fragments) — never re-implement them.
3. **⛔ Review (fail-closed gate)** before commit: `pnpm check` = `pnpm typecheck` (`tsc --noEmit`) + `pnpm lint` (`biome check src tests`) + `pnpm test` (`vitest run`), **0 errors**. New/changed tool, route, or schema → a vitest is **mandatory** (see "Mandatory tests" below). **For any tool that touches sensitive data or performs writes** (`destructiveHint`, anything under `accountId`-required, credential/PII-bearing bodies), also run a **model-diversity cross-review** of the diff via `.codex/bin/codex-review` — catches account-scoping leaks, wrong route, missing destructive annotation. Pure docs/comment/lint-only changes are exempt. **Enforcement reality:** this gate is self-run for in-loop work — only `pnpm prepublishOnly` (and the root `pre-deploy-gate.sh` hook) hard-blocks at *publish* time. Do not rely on a hook to catch a lint/type/test failure mid-loop; run `pnpm check` yourself and read the output.
4. **⛔ Tool↔route parity (fail-closed gate)** — a tool is NOT done when it type-checks; it is done when its zod schema and handler match the **real Chatwoot route** end-to-end. For each new/changed tool verify: (a) the handler hits a route that actually exists in `../Chatwoot/config/routes.rb` (cite it in the JDoc, as `pipeline-cards.ts` does); (b) the zod `inputSchema` matches the params the controller accepts (types too — e.g. stage IDs are `z.string()`, not number); (c) the right annotation (`readOnlyHint`/`idempotentHint`/`destructiveHint`); (d) account scoping correct (`optionalAccountId` for read/CRUD, required `accountId` for irreversible ops); (e) it is registered in `src/tools/index.ts` — **no orphan tool** (an exported `register` not wired into the aggregator never loads). If a single-file edit is intentionally registry-only or internal, state that explicitly.
5. **Real-behavior test** — `pnpm build` (tsup → `dist/index.js`), then exercise the changed tool over MCP stdio against a real NooviChat instance (or via an MCP host). The vitest suite asserts the handler builds the correct URL with mocked `client`; the smoke proves the route resolves and returns the expected shape. A green `pnpm test` alone does **not** satisfy this — prove the tool calls the right route against a live API when feasible.
6. **⛔ Contract sync — downstream of the Chatwoot API (MANDATORY for every fix AND feature)** — **this server is a CONSUMER of the Chatwoot REST API; it is the *downstream* side of the contract.** Ask explicitly: *did the Chatwoot API change (route/param/response field/status/auth), or did I change a tool's route/schema that must mirror it?* If yes, the tool here is updated **in the same cycle** — never leave silent drift. Cross-check the Chatwoot side `../Chatwoot/docs/rules/mcp-sync.md` (the keystone is the Chatwoot OpenAPI spec under `Chatwoot/swagger/`; the root detector `Chatwoot/.claude/scripts/downstream-sync-check.sh` maps a touched resource to its MCP counterpart file). A route/contract change → update the tool **and** bump the package version **and** `pnpm publish` the same day (and flag the sibling `@nooviai/n8n-nodes-noovichat` for the matching bump). If nothing API-facing changed, say so explicitly. Never skip the question.
7. **Atomic commit (autonomous)** — Conventional Commits, one logical unit, deployable/revertable alone. Commit straight to `main`; this is NOT a human gate. `pnpm version` bump is reserved for the human-approved release step, not every commit.
8. **⛔ Close the cycle — update internal docs — MANDATORY, NEVER skip.** Update canonical technical docs (the private Obsidian process) for anything that changed (tools, resources, API mirroring), and the README "Features exposed" table when a tool was added/removed. If nothing documentable changed (pure refactor, lint, trivial fast-path edit), state that and skip — but always ask.

**The only thing outside this autonomous loop is production release** — `pnpm version` + `pnpm publish --access public` + the tag push. Run `/pre-publish-audit` first (**clean tree + HEAD pushed** + `pnpm check` + `pnpm build` + `dist/index.js` present); G3 (Chatwoot deploy window) does **not** apply to this versioned npm package. It needs human approval + the 5 golden rules and is gated by the root `pre-deploy-gate.sh` hook (G1/G2). The internal-docs update (step 8) IS part of the loop and closes it.

### ⛔ Native cohesion & reuse-first (build it as if it shipped in the catalog)

Every tool is built native and cohesive — it reuses what exists and never duplicates. Before adding, search — then extend, don't duplicate: **helpers** (extend `_helpers.ts`; reuse `safeHandler`/`resolveAccountId`/`pagination`/shared id fragments before adding a new one), **client** (route all HTTP through `client.ts` — never hand-roll `fetch`), **tool files** (a new action on an existing resource edits that resource file; a genuinely new resource gets a new file + an `index.ts` entry), **zod fragments** (reuse the top-of-file `const fooId = …` and the shared `_helpers` fragments before redefining). Cite what you reused in the cycle summary, or state explicitly that it is a genuinely new building block.

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
8. Bump version + publish (human-approved; G1/G2, not the Chatwoot G3 window).

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
