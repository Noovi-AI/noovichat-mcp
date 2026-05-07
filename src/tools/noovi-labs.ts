/**
 * NooviLabs — experimental feature flag panel.
 *
 * Status: NO PUBLIC API SURFACE TODAY.
 *
 * NooviLabs is currently a frontend-only construct. The flag definitions,
 * gating logic and toggle UI live entirely in the Vue dashboard:
 *   - app/javascript/dashboard/featureFlags.js
 *   - app/javascript/dashboard/routes/dashboard/pipeline/NooviLabsView.vue
 *
 * The only backend artifact is `app/listeners/noovi_labs_listener.rb`,
 * which routes Chatwoot domain events into pipeline-automation triggers.
 * It is a passive listener — there is no REST controller, no model
 * persisting "labs flags per agent/account", no JSON endpoint we can hit.
 *
 * Therefore the MCP cannot today list, enable or disable NooviLabs flags
 * server-side. Toggling happens in the dashboard, scoped to the logged-in
 * agent's local state.
 *
 * What we'd LIKE to expose (roadmap — requires backend work):
 *   - list_noovi_labs_flags          → all defined flags with enabled state
 *                                       per account or per agent
 *   - enable_flag / disable_flag      → flip a flag (account or agent scope)
 *   - get_flag_state                  → resolved boolean for a feature_id
 *
 * Recommended follow-up implementation:
 *   1. Move `featureFlags.js` definitions to a Rails-side registry
 *      (e.g. `config/noovi_labs_flags.yml` or DB-backed `noovi_lab_flag` model).
 *   2. Create `app/controllers/api/v1/accounts/noovi_labs/flags_controller.rb`
 *      with `index`, `update` (admin-only via Pundit), and a per-agent
 *      preference store on `User` or `AccountUser`.
 *   3. Mount under `/api/v1/accounts/:account_id/noovi_labs/flags`.
 *   4. Then re-enable the tools listed above in this module.
 *
 * Until that controller exists, this module registers ZERO tools.
 */

import type { RegisterFn } from "../types.js";

export const register: RegisterFn = (_server, _client) => {
  // No tools registered — feature is frontend-only today. See file header
  // for the recommended backend implementation that would unlock MCP
  // access to NooviLabs flag state.
};
