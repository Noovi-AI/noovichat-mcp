#!/usr/bin/env bash
# Publish this package when package.json is strictly newer than npm.
# Never unpublish, never delete tags, never republish the same version.
#
# AUTO_BUMP=1 (default-branch publish job): if contract files changed since
# the npm version's git tag and the numbers still match, patch-bump, tag,
# push, then publish. Docs-only commits do not bump.
set -euo pipefail

PKG="$(node -p "require('./package.json').name")"
GIT_VER="$(node -p "require('./package.json').version")"
TOKEN="${NODE_AUTH_TOKEN:-${NPM_TOKEN:-}}"
AUTO_BUMP="${AUTO_BUMP:-0}"

if [ -z "$TOKEN" ]; then
  echo "ERRO: NODE_AUTH_TOKEN/NPM_TOKEN ausente — configure o secret npm no GitHub." >&2
  exit 1
fi
export NODE_AUTH_TOKEN="$TOKEN"

npm_ver() { npm view "$PKG" version 2>/dev/null || true; }

semver_cmp() {
  python3 - "$1" "$2" <<'PY'
import sys
a, b = sys.argv[1], sys.argv[2]
def p(v):
    if not v:
        return None
    return tuple(int(x) for x in v.split(".")[:3])
ga, gb = p(a), p(b)
if gb is None:
    sys.exit(1)   # git newer / first publish
if ga is None:
    sys.exit(2)
if ga < gb:
    sys.exit(2)   # git older — refuse
if ga == gb:
    sys.exit(0)   # equal
sys.exit(1)       # git newer
PY
}

contract_changed_since() {
  local base="$1"
  git rev-parse --verify --quiet "${base}^{commit}" >/dev/null 2>&1 || return 1
  git diff --name-only "${base}..HEAD" -- src package.json | grep -E '^(src/|package\.json$)' >/dev/null
}

NPM_VER="$(npm_ver)"
echo "package $PKG  git=$GIT_VER  npm=${NPM_VER:-none}"

if [ "$AUTO_BUMP" = "1" ] && [ -n "$NPM_VER" ]; then
  cmp=0
  semver_cmp "$GIT_VER" "$NPM_VER" || cmp=$?
  if [ "$cmp" = "0" ] && contract_changed_since "v$NPM_VER"; then
    echo "contract changed since v$NPM_VER and version was not bumped — patch bump"
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    pnpm version patch --no-git-tag-version
    GIT_VER="$(node -p "require('./package.json').version")"
    git add package.json
    git commit -m "chore(release): ${GIT_VER}"
    git tag -a "v${GIT_VER}" -m "v${GIT_VER}"
    git push origin HEAD --follow-tags
  fi
fi

NPM_VER="$(npm_ver)"
cmp=0
semver_cmp "$GIT_VER" "$NPM_VER" || cmp=$?
case "$cmp" in
  0)
    echo "already on npm: $PKG@$GIT_VER — skip"
    exit 0
    ;;
  2)
    echo "ERRO: git $GIT_VER is older than npm ${NPM_VER} — recusar publish" >&2
    exit 1
    ;;
esac

echo "publishing $PKG@$GIT_VER"
pnpm publish --access public --no-git-checks

if command -v gh >/dev/null 2>&1; then
  gh release view "v${GIT_VER}" >/dev/null 2>&1 || \
    gh release create "v${GIT_VER}" --title "v${GIT_VER}" --generate-notes || \
    echo "aviso: GitHub Release v${GIT_VER} não criada (não aborta o npm)"
fi
