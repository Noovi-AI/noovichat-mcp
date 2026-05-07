# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in `@nooviai/noovichat-mcp`,
please **do not open a public GitHub issue**. Instead, report it
privately so we can fix it before it becomes exploitable.

**Email:** security@nooviai.com (preferred) or contato@nooviai.com
**Encryption:** if you need PGP, ask first via the email above.

Please include:

- A short description of the issue.
- Steps to reproduce, or a minimal proof-of-concept.
- The affected version (`npx @nooviai/noovichat-mcp --version`).
- Any thoughts you have on impact / mitigation.

We aim to:

- Acknowledge your report within **2 business days**.
- Provide an initial assessment within **5 business days**.
- Ship a fix or coordinated disclosure plan as soon as feasible.

## Scope

This policy covers:

- The published npm package `@nooviai/noovichat-mcp` and the source in
  this repository.
- The MCP server's handling of user-provided env vars
  (`NOOVICHAT_API_TOKEN`, `NOOVICHAT_BASE_URL`).
- The HTTP client behavior (auth header, URL composition, error
  surfacing).

Out of scope (please report to the relevant project instead):

- Vulnerabilities in upstream Chatwoot or in the NooviChat Rails
  backend itself.
- Vulnerabilities in MCP hosts (Claude Desktop, Cursor, VS Code) — see
  their respective security policies.
- Vulnerabilities in our customers' NooviChat instances themselves.

## Operator security guidance

When deploying this MCP server, operators are responsible for:

1. **Token scope** — `NOOVICHAT_API_TOKEN` inherits the role of the
   agent it belongs to. Use the **least-privileged** agent that still
   accomplishes the goal. Never use a SuperAdmin token for routine LLM
   sessions.

2. **Token storage** — store tokens only in:
   - The MCP host's encrypted env config (e.g., Claude Desktop config),
     OR
   - A secret manager (1Password, Bitwarden, HashiCorp Vault).
   Do **not** commit `.env` files; the project's `.gitignore` blocks
   them by default.

3. **Logs** — the MCP host's logs may contain tool-call results
   including PII (contact names, phone numbers, message bodies). Treat
   logs as sensitive: don't paste them in public forums when asking for
   help. Redact emails / phone numbers before sharing.

4. **Network** — the server runs locally as a stdio subprocess of the
   MCP host. It connects outbound to your `NOOVICHAT_BASE_URL`. Use
   HTTPS-only base URLs.

5. **Rotation** — rotate `NOOVICHAT_API_TOKEN` if you suspect leakage
   (e.g., logs accidentally shared). The old token can be revoked from
   the NooviChat profile settings.

## Supply chain

This package depends on a small number of third-party packages — see
`package.json`. We pin minor ranges (`^x.y.z`) and rely on the package
host's verification. CI runs:

- `pnpm install --frozen-lockfile` to prevent unexpected version drift
- Automated dependency audit on every push (TBD: dependabot/renovate)

If you want to verify supply chain on a specific install, run:

```bash
pnpm audit
pnpm why <suspicious-package>
```

## Coordinated disclosure

For high-severity issues, we follow standard 90-day coordinated
disclosure unless a shorter timeline is needed (active exploitation).
We'll work with you on the disclosure plan and credit you in the
advisory unless you prefer to remain anonymous.

## Hall of fame

Researchers who responsibly disclose valid issues are credited in
release notes (with their consent). No bug bounty at this time.
