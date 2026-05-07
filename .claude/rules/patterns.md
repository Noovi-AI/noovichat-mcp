# NooviChat-MCP — Code patterns

## 1. Tool registration pattern

The single canonical pattern. Every tool follows this exactly.

```typescript
server.registerTool(
  "tool_name",                                           // (1) snake_case verb_resource
  {
    title: "Human title",                                // (2) short, displayed in UI
    description: "What it does in one clear sentence.",  // (3) the LLM reads this to choose
    inputSchema: {                                       // (4) zod fragments — no z.object wrap
      account_id: optionalAccountId,
      foo: z.string().describe("..."),
    },
    annotations: { readOnlyHint: true },                 // (5) hint for the host
  },
  async ({ account_id, foo }) =>                         // (6) handler always async
    safeHandler(() => {                                  // (7) ALWAYS wrap in safeHandler
      const acc = resolveAccountId(account_id);          // (8) account fallback
      return client.get(`/api/v1/accounts/${acc}/...`);  // (9) return the promise
    }),
);
```

## 2. Zod schema patterns

```typescript
// Numeric IDs (Rails serial PKs, big positive integers)
const cardId = z.number().int().positive().describe("Pipeline card ID");

// Required + optional account
account_id: accountId,           // required (z.number().int().positive())
account_id: optionalAccountId,   // optional with env fallback

// Enums (closed sets)
priority: z.enum(["low", "medium", "high", "urgent"]),
status: z.enum(["open", "won", "lost"]),

// Pagination (use the spread helper)
{ ...pagination }                // adds page + per_page

// Free-form metadata
custom_attributes: z.record(z.string(), z.unknown()).optional(),
item_details: z.record(z.string(), z.unknown()).optional(),

// Arrays of IDs
card_ids: z.array(z.number().int().positive()).min(1),

// Nullable to support unassign
owner_id: agentUserId.nullable().describe("Pass null to unassign"),

// Date/time as ISO8601 string (zod doesn't parse — server does)
scheduled_at: z.string().describe("ISO8601 datetime"),
```

## 3. Endpoint URL composition

Always use template literals, never string concatenation:

```typescript
// Good
client.get(`/api/v1/accounts/${acc}/pipelines/${pipeline_id}/stages`);

// Bad — fragile, hard to grep
client.get("/api/v1/accounts/" + acc + "/pipelines/" + pipeline_id + "/stages");
```

For query params, pass an object — the client handles encoding:

```typescript
client.get(`/api/v1/accounts/${acc}/pipeline_cards`, {
  page: 1,
  per_page: 50,
  status: "open",
  tag_ids: [1, 2, 3],          // becomes ?tag_ids[]=1&tag_ids[]=2&tag_ids[]=3
});
```

## 4. POST/PATCH bodies

Pass the request body as the second argument to `client.post/patch`. The
client adds `Content-Type: application/json` and serializes.

```typescript
client.post(`/api/v1/accounts/${acc}/pipeline_cards`, {
  pipeline_id,
  pipeline_stage_id,
  title,
  contact_id,
  // ... other fields
});
```

Use object spread to forward validated input minus consumed fields:

```typescript
async ({ account_id, card_id, ...body }) =>
  safeHandler(() => {
    const acc = resolveAccountId(account_id);
    return client.patch(`/api/v1/accounts/${acc}/pipeline_cards/${card_id}`, body);
  }),
```

## 5. Annotations

Pick the right hint:

| Hint | Use for | Example tools |
|---|---|---|
| `readOnlyHint: true` | All GET (no mutation) | `list_pipelines`, `get_card`, `get_pipeline_analytics_dashboard` |
| `idempotentHint: true` | PATCH / PUT (safe to repeat) | `update_card`, `update_followup`, `update_pipeline_automation` |
| `destructiveHint: true` | DELETE, hard cancels, irreversible state changes | `delete_card`, `permanently_delete_card`, `cancel_broadcast`, `lgpd_delete_contact` |

If a tool has none of these properties (e.g., `create_card`), omit the
`annotations` field entirely — the SDK assumes the operation is "regular
(non-idempotent, non-destructive, mutating)" by default.

## 6. JSDoc at top of file

Every tool file starts with a JSDoc block listing the route(s) it covers.
This helps grep ("which tool maps to /api/v1/accounts/X/Y?") and makes API
drift checking automatic.

```typescript
/**
 * Pipeline Pro — automations.
 *
 * Routes (Chatwoot/config/routes.rb 592-621):
 *   GET    /api/v1/accounts/:account_id/pipeline/automations
 *   GET    /api/v1/accounts/:account_id/pipeline/automations/:id
 *   POST   /api/v1/accounts/:account_id/pipeline/automations
 *   ...
 */
```

## 7. Don't manually wrap responses

```typescript
// ❌ WRONG — duplicates safeHandler's job, breaks error handling
async (input) => {
  const result = await client.get(...);
  return jsonText(result);
}

// ✅ CORRECT — safeHandler wraps + handles NooviChatApiError uniformly
async (input) =>
  safeHandler(() => client.get(...)),
```

## 8. Don't catch errors in handlers

`safeHandler` already catches `NooviChatApiError` and turns it into a clean
MCP error payload. Other errors are real bugs — let them bubble.

```typescript
// ❌ WRONG — silently swallows bugs
async (input) =>
  safeHandler(async () => {
    try {
      return await client.get(...);
    } catch (err) {
      return { fallback: true };
    }
  }),

// ✅ CORRECT — let real errors bubble
async (input) =>
  safeHandler(() => client.get(...)),
```

## 9. File organization rules

- **One resource per file** — group all CRUD + actions for that resource
- **No cross-file imports** of tool registration logic — only of helpers
- **Files in alphabetic-ish groups** in `tools/index.ts` for readability:
  pipelines first (flagship), then "customer engagement", then "WhatsApp",
  then "CRM", then "extensions/admin"

## 10. Test pattern

Every tool file has a sibling test file in `tests/tools/<resource>.test.ts`
asserting:
1. The expected tools are registered (count + names)
2. Each tool's schema includes its required fields
3. (Optional) The handler calls the right URL with mocked client

A smoke test in `tests/server.test.ts` asserts the total tool count for the
whole server (catches accidental regressions where a module fails to register).
