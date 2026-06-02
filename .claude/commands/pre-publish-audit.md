---
description: MCP server pre-publish battery — deploy window, git gate, pnpm check, build, dist verification. Blocking before any pnpm publish.
---

# /pre-publish-audit (NooviChat-MCP)

Mandatory validation before `pnpm publish`. A published npm version **cannot be
removed** — a broken publish breaks every MCP host (Claude Desktop/Code/Cursor) on
next session. Any failure ABORTS. Codifies the golden rules (`CLAUDE.md`).

## When to use

- **ALWAYS** before `pnpm publish` / `pnpm version`
- After any change to `src/tools/`
- After a Chatwoot API change that touched a mirrored resource (see `../Chatwoot/docs/rules/mcp-sync.md`)

## Workflow

```bash
set -e
cd "/home/debian/projects/Noovichat/NooviChat-MCP"
FAIL=0

# Deploy window (BRT) — forbidden Mon-Fri 08-19h and Fri night
HOUR_BR=$(TZ=America/Sao_Paulo date +%H); DOW=$(TZ=America/Sao_Paulo date +%u)
if { [ "$DOW" -ge 1 ] && [ "$DOW" -le 5 ] && [ "$HOUR_BR" -ge 8 ] && [ "$HOUR_BR" -lt 19 ]; } \
   || { [ "$DOW" = "5" ] && [ "$HOUR_BR" -ge 19 ]; }; then
  echo "❌ ABORT: outside deploy window (Mon-Fri 08-19h BRT / Fri night). Emergency: NOOVI_FORCE_DEPLOY=1."
  [ "${NOOVI_FORCE_DEPLOY:-0}" = "1" ] || exit 1
fi
echo "✓ Deploy window OK"

# Git integrity
git diff --exit-code --quiet || { echo "❌ ABORT: unstaged changes"; exit 1; }
git diff --cached --exit-code --quiet || { echo "❌ ABORT: staged but uncommitted"; exit 1; }
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin "$BRANCH" --quiet 2>/dev/null || true
[ "$(git log "origin/$BRANCH..HEAD" --oneline 2>/dev/null | wc -l)" = "0" ] \
  || { echo "❌ ABORT: unpushed commits — git push first"; exit 1; }
echo "✓ Git clean + HEAD pushed"

# Quality gate (typecheck + biome lint + vitest)
pnpm check || { echo "❌ pnpm check failed (typecheck/lint/test)"; FAIL=1; }

# Build + artifact verification
pnpm build || { echo "❌ build failed"; FAIL=1; }
[ -f dist/index.js ] || { echo "❌ missing build artifact: dist/index.js"; FAIL=1; }
echo "✓ dist/index.js present"

# API-sync reminder
if git diff HEAD~5 --name-only 2>/dev/null | grep -qE 'src/tools/'; then
  echo "⚠ src/tools changed — cross-check ../Chatwoot/docs/rules/mcp-sync.md (route change → bump minor here AND in the n8n node same day)"
fi

if [ "$FAIL" = "0" ]; then
  echo ""
  echo "✅ PRE-PUBLISH AUDIT PASSED — ready for: pnpm version <patch|minor|major> && git push --follow-tags && pnpm publish --access public"
else
  echo ""
  echo "❌ PRE-PUBLISH AUDIT FAILED — fix the items above before publishing."
  exit 1
fi
```

## Notes

- `pnpm publish` is gated by the root `pre-deploy-gate.sh` hook (dirty tree / window) — fixed this session so pnpm publish is no longer ungated.
- Publish is a conscious human decision; this audit prepares and validates, it does not publish.
