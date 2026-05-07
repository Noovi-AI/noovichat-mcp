/**
 * NooviLicense — DRM/licensing system (admin / diagnostic).
 *
 * Status: NO PUBLIC API SURFACE TODAY.
 *
 * NooviLicense is implemented entirely as internal Ruby classes under
 * `lib/noovi_license/` plus a controller concern (`feature_access`) and
 * background jobs (`license_validation_job`, `license_heartbeat_job`,
 * `license_integrity_check_job`, `license_feature_denial_job`,
 * `heartbeat_job`). It calls out to `api.noovichat.com` (the Site backend)
 * over HTTPS — there is no Chatwoot-side REST endpoint that the MCP can
 * reach via `api_access_token`.
 *
 * What we'd LIKE to expose (roadmap — requires creating a controller):
 *   - get_license_status            → plan, features, expiry, grace state
 *   - list_enabled_features         → resolved feature flags from FeatureGating
 *   - check_feature_enabled         → boolean for one feature_id
 *   - force_license_heartbeat       → re-runs LicenseHeartbeatJob now
 *   - validate_license_signature    → re-verifies the cached license JWT
 *
 * Recommended follow-up implementation:
 *   1. Create `app/controllers/api/v1/accounts/noovi_license/diagnostics_controller.rb`
 *      (admin/super_admin scope, account-scoped Pundit policy).
 *   2. Wrap `NooviLicense::FeatureGating.instance.status`,
 *      `NooviLicense::FeatureGating.instance.enabled?(feature_id)` and
 *      `NooviLicense::ValidationService.new(...).call` as JSON endpoints.
 *   3. Mount under `/api/v1/accounts/:account_id/noovi_license/{status,features,heartbeat,validate}`.
 *   4. Then re-enable the tools below in this module.
 *
 * Until that controller exists, this module registers ZERO tools — we
 * deliberately avoid registering tools that would always return 404.
 *
 * Internal references (read-only, not callable from MCP):
 *   - lib/noovi_license/feature_gating.rb       (FeatureGating.instance.{status,enabled?,limit_for,within_limit?})
 *   - lib/noovi_license/validation_service.rb   (.call → re-validates against api.noovichat.com)
 *   - lib/noovi_license/signature_validator.rb  (RSA-SHA256 PKCS1v15 verify)
 *   - app/controllers/concerns/feature_access.rb (require_feature!, require_within_limit!)
 *   - app/jobs/license_heartbeat_job.rb         (periodic heartbeat to api.noovichat.com)
 *   - app/jobs/license_validation_job.rb        (full re-validation)
 *   - app/jobs/license_integrity_check_job.rb   (code-integrity hash check)
 */

import type { RegisterFn } from "../types.js";

export const register: RegisterFn = (_server, _client) => {
  // No tools registered — no public REST surface today. See file header for
  // the recommended follow-up controller and the tool list we'd register
  // once `/api/v1/accounts/:account_id/noovi_license/*` exists.
};
