/**
 * Flow Builder (ex-NooviLabs) — visual automation canvas for Pipeline Pro.
 *
 * Status: NO DEDICATED MCP TOOLS — the backend is already covered elsewhere.
 *
 * Flow Builder is the visual canvas in the Vue dashboard where users build and
 * edit Pipeline Pro automations (triggers → conditions → actions), browse
 * templates and inspect execution history:
 *   - app/javascript/dashboard/routes/dashboard/pipeline/FlowBuilderView.vue
 *   - .../pipeline/automations/FlowBuilder.vue
 *   - .../pipeline/components/PipelineAutomationsFlowBuilder.vue
 * Gated by the `flow_builder` feature flag (config/features.yml).
 *
 * The canvas persists its flows as **pipeline automations**. That REST surface
 * (CRUD on automations + executions) is ALREADY exposed by the
 * `pipeline-automations` MCP module — there is nothing extra for Flow Builder
 * to wrap here.
 *
 * The only other backend artifact is `app/listeners/flow_builder_listener.rb`,
 * a passive listener that routes Chatwoot domain events (conversation, message,
 * contact, and pipeline item events) into flow-automation triggers. It has no
 * REST controller and no JSON endpoint to hit.
 *
 * Therefore this module registers ZERO tools. To drive Flow Builder flows via
 * MCP, use the `pipeline-automations` tools.
 */

import type { RegisterFn } from "../types.js";

export const register: RegisterFn = (_server, _client) => {
  // No tools registered — Flow Builder flows are pipeline automations, exposed
  // via the `pipeline-automations` module. See the file header.
};
