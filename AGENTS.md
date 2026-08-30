# NooviChat-MCP Codex Instructions

Codex is autonomous here and does not depend on Claude Code. Use the monorepo
root `AGENTS.md` plus this file as the source of truth (there is no
`.codex/prompts/project-context.md` in this repo).

Role: Model Context Protocol server (`@nooviai/noovichat-mcp`, TypeScript,
Node 20+) that wraps the NooviChat (Chatwoot fork) REST API and exposes a tool
catalog to MCP hosts (Claude Desktop/Code, Cursor, VS Code). It is a thin HTTP
wrapper — all business logic lives in the Rails app. Stack: TypeScript strict,
Zod, `tsup` build, `vitest`, Biome (lint+format).

Codex may edit `src/tools/`, `src/client.ts`, `src/_helpers.ts` (via the
`_helpers.ts` under `src/tools/`), tests, and docs. Do not run `pnpm
version`, `pnpm publish`, or push a version tag unless a human explicitly
requested that release action for the current turn — a published npm version
cannot be removed, only deprecated, and every MCP host picks it up on next
`npx` invocation.

Cycle: `recon -> implement (reuse-first: one resource per src/tools/*.ts, a
single register: RegisterFn, reuse _helpers.ts — safeHandler,
resolveAccountId, pagination — never hand-roll fetch) -> review (pnpm check =
typecheck + lint + test, 0 errors) -> tool<->route parity (handler hits a real
Chatwoot route cited in JDoc, zod schema matches accepted params, correct
readOnlyHint/idempotentHint/destructiveHint, account-scoped, registered in
src/tools/index.ts — no orphan tool) -> real-behavior test (pnpm build, then
exercise over MCP stdio against a real NooviChat instance) -> contract sync
(Chatwoot API changed? update the matching tool in the same cycle) -> docs ->
commit -> stop`.

Expected checks: `pnpm check` (`pnpm typecheck` + `pnpm lint` + `pnpm test`),
0 errors. A new/changed tool, route, or schema needs a mandatory vitest (see
`CLAUDE.md` "Mandatory tests"). For any tool touching sensitive data or
performing writes, also run a model-diversity cross-review of the diff via
`.codex/bin/codex-review` when available.

This server is downstream surface #4 of the Chatwoot API contract (of 4
defined in the root `docs/rules/loop-engineering.md`) — a change on the
Chatwoot side (`app/controllers/api/v1/accounts/*.rb`, `config/routes.rb`) may
require a matching tool update here, cross-checking
`../Chatwoot/docs/rules/mcp-sync.md`. Never trust an `account_id` parameter
blindly — the API token scopes access server-side; never log full request
bodies (customer PII).

## Codex + Claude Code Shared Usage

- Este arquivo e a fonte comum de instrucoes para agentes de codigo neste repositorio.
- Claude Code deve consumir estas instrucoes via `CLAUDE.md`.
- Procedimentos longos e reutilizaveis devem ficar em skills sob `.ai/skills`, `.agents/skills` ou `.claude/skills`, nao neste arquivo.
- Configuracoes especificas de Codex permanecem em `.codex/`; configuracoes especificas de Claude Code permanecem em `.claude/`.
