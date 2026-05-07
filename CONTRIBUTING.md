# Contributing to `@nooviai/noovichat-mcp`

Thanks for the interest. This is a focused project — we keep its
surface aligned with the NooviChat REST API, not broader feature work.

## Quick start

```bash
git clone https://github.com/Noovi-AI/noovichat-mcp.git
cd noovichat-mcp
pnpm install
pnpm check        # typecheck + lint + tests
```

## What we accept

- **Bug fixes** — regression in an existing tool, broken zod schema,
  wrong route path.
- **New tools for existing routes** — endpoints we missed when
  bootstrapping. Show us the route in `routes.rb` from the NooviChat
  Rails backend in your PR description.
- **Doc improvements** — README, CLAUDE.md, JSDoc clarifications.
- **Schema tightening** — making validation more accurate (e.g. closed
  enums where we have `z.string()` today).
- **Test coverage** — per-tool tests asserting URL composition.

## What we typically don't accept

- **New endpoints not in the NooviChat backend** — this is a wrapper,
  not a feature engine. Backend changes go to the Rails repo first.
- **Tool renames without migration period** — breaks LLM hosts that
  cached the old name.
- **Manual `jsonText` calls** — always use `safeHandler`.
- **Tools that depend on env vars beyond the documented set** — keep
  the surface small.

## Pattern checklist for new tools

Before opening a PR, confirm:

- [ ] Tool is registered in the right `src/tools/<resource>.ts` file.
      If it's a new resource, add the import + entry in
      `src/tools/index.ts` too.
- [ ] Name follows `<verb>_<resource>` snake_case
      (`list_pipelines`, `move_card_to_stage`).
- [ ] `description` is one sentence, written for the LLM (it's what
      Claude reads to decide when to call your tool).
- [ ] `inputSchema` uses zod fragments. Reuses helpers from
      `_helpers.ts` where applicable (`accountId`, `pagination`,
      `customAttributes`, etc.).
- [ ] `annotations` set: `readOnlyHint` for GET, `idempotentHint` for
      PATCH/PUT, `destructiveHint` for DELETE / `permanently_*` /
      `cancel`.
- [ ] Handler is wrapped in `safeHandler(() => client.METHOD(...))` —
      no manual JSON wrapping.
- [ ] Account ID resolved via `resolveAccountId(account_id)`.
- [ ] Test added in `tests/` asserting registration + (where feasible)
      URL composition with a mocked client.
- [ ] JSDoc at top of the file lists the route(s) the module covers.
- [ ] `pnpm check` passes locally.

## Commit style

Conventional Commits, scope = the resource module:

```
feat(pipeline-cards): add bulk_archive_cards tool
fix(follow-ups): correct query param name to scheduled_from
docs(readme): clarify Claude Desktop config example
test(client): cover 504 timeout path
chore(deps): bump @modelcontextprotocol/sdk to 1.28.0
```

## PR template

Include in the PR description:

1. **What it does** (1 sentence).
2. **Why** (link to issue, or paste route from `routes.rb`).
3. **Test plan** — what you ran locally; output of `pnpm check`.
4. **Breaking changes** — yes/no; if yes, what migration looks like.

## Releases

We follow [SemVer](https://semver.org/):

- **patch** — bug fixes, doc fixes, internal refactors
- **minor** — new tools, new resources, new optional schema fields
- **major** — renames, removals, required-field additions to existing
  schemas

Releases are gated by CI (typecheck + lint + tests + build). Tag a
release via `pnpm version <patch|minor|major>` and push the tag — the
publish workflow handles npm.

## Code of Conduct

Be kind, be specific, be patient. Don't share other people's data
without permission. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).

## License

By contributing you agree your contributions are licensed under the
MIT license, same as the project (see `LICENSE`).
