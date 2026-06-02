# NooviChat-MCP — Commands

## Setup

```bash
cd noovichat-mcp        # wherever you cloned the repo
pnpm install            # or npm install / yarn
```

## Development

```bash
# Watch mode — rebuilds on file change
pnpm dev

# Build once
pnpm build         # → dist/index.js + dist/index.d.ts

# Build check (typecheck without emit)
pnpm build:check

# Run the built server
NOOVICHAT_BASE_URL=https://chat.example.com \
NOOVICHAT_API_TOKEN=xxx \
pnpm start
```

## Quality gates

```bash
# Typecheck
pnpm typecheck

# Lint (Biome)
pnpm lint
pnpm lint:fix

# Format
pnpm format

# Tests
pnpm test
pnpm test:watch
pnpm test:coverage

# Everything (CI uses this)
pnpm check         # typecheck + lint + test
```

## Smoke test against a real instance

After build, point at your NooviChat instance:

```bash
NOOVICHAT_BASE_URL=https://chat.example.com \
NOOVICHAT_API_TOKEN=$(cat ~/.noovichat-token) \
node dist/index.js < /dev/null
```

The server reads stdin (MCP JSON-RPC) and writes responses to stdout. Pressing
Ctrl-D closes stdin and the server exits cleanly.

For an end-to-end test, set up Claude Desktop (or Claude Code) with a local
config pointing at `node /absolute/path/to/dist/index.js` — see README.

## Publish

```bash
# 1. Bump version
pnpm version patch        # 0.1.0 → 0.1.1
pnpm version minor        # 0.1.x → 0.2.0  (new tools/resources)
pnpm version major        # 0.x.x → 1.0.0  (breaking changes)

# 2. (Implicit) prepublishOnly runs build + check
# 3. Publish
pnpm publish --access public

# 4. Push tag created by `pnpm version`
git push --follow-tags
```

> **Reminder:** publishing is a deploy gate. See root
> `docs/rules/deploy-safety.md` and `docs/rules/release-cadence.md`.
> Working tree must be clean, not in business hours BR.

## Adding a new tool

1. Edit `src/tools/<resource>.ts`
2. Register the tool with the canonical pattern (see `patterns.md`)
3. Add a test in `tests/tools/<resource>.test.ts`
4. `pnpm check`
5. Commit (conventional commits required by monorepo rules):
   - `feat(tools): add <tool_name> for <resource>`

## Adding a new resource

1. Create `src/tools/<resource>.ts` with `register: RegisterFn`
2. Add the import + entry to `src/tools/index.ts`
3. Update README "Features exposed" table
4. Add tests
5. `pnpm check`
6. Commit:
   - `feat(tools): add <resource> module with N tools`

## Debugging in Claude Desktop

Logs from the server's `console.error(...)` show up in:
- macOS: `~/Library/Logs/Claude/mcp-server-<name>.log`
- Windows: `%APPDATA%\Claude\logs\mcp-server-<name>.log`

`console.log` does NOT work — stdout is reserved for the JSON-RPC transport.
Always use `console.error` (which goes to stderr → log file).

## Useful greps when validating against the backend

When developing alongside the NooviChat Rails repo, common lookups:

```bash
# Find what route a controller exposes
grep -n "PipelineCardsController\|pipeline_cards_controller" \
  path/to/noovichat-rails/config/routes.rb

# Find all NooviChat custom routes (between markers)
sed -n '/NooviChat Customizations Start/,/NooviChat Customizations End/p' \
  path/to/noovichat-rails/config/routes.rb

# What endpoints does the n8n node already use?
grep -rn "nooviChatApiRequest" path/to/n8n-nodes-noovichat/nodes/
```
