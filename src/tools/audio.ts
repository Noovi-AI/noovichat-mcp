/**
 * Audio normalization (OGG/Opus fix).
 *
 * Status: NO PUBLIC API SURFACE TODAY.
 *
 * Audio normalization is a NooviChat patch that ensures incoming/outgoing
 * audio attachments are tagged with the correct MIME (`audio/ogg; codecs=opus`)
 * across WhatsApp Cloud API, WAHA and UAZAPI channels. It is implemented
 * exclusively as:
 *
 *   - A concern injected into 5+ messaging services:
 *       app/services/attachments/audio_normalization.rb
 *       (included in whatsapp/incoming_message_base_service.rb,
 *        waha/incoming_message_service.rb, waha/send_on_waha_service.rb,
 *        uazapi/incoming_message_service.rb, uazapi/send_on_uazapi_service.rb,
 *        pipeline_sequences/step_handlers/whatsapp_media_handler.rb)
 *   - A Marcel MIME override initializer:
 *       config/initializers/marcel_audio_mime_override.rb
 *   - A magic-byte sniff helper used by transcription:
 *       enterprise/app/services/messages/audio_transcription_service.rb#detect_audio_extension
 *   - Inline normalization for Cloud API:
 *       app/services/whatsapp/providers/whatsapp_cloud_service.rb#normalize_opus_content_type
 *   - A maintenance rake task to repair existing blobs:
 *       lib/tasks/fix_audio_blob_mime.rake
 *
 * There is no controller, no REST endpoint and no JSON job-trigger surface.
 * The fix runs automatically on every audio message; the rake task is
 * meant to be invoked from a server shell, not over HTTP:
 *
 *     RAILS_ENV=production bundle exec rake noovichat:fix_audio_blob_mime
 *
 * Not exposed over MCP today because there is no public API surface yet.
 * If this becomes product work, track it in /home/debian/projects/Noovichat/Roadmap/.
 *
 * Possible future API shape:
 *   - run_audio_mime_repair    → kick off the rake task body via background
 *                                 job, returning the job ID for status polling
 *   - get_audio_repair_status  → progress / counts of last run
 *
 * Recommended follow-up implementation:
 *   1. Move the rake task body into a service:
 *        `app/services/attachments/fix_audio_blob_mime_service.rb`.
 *   2. Wrap it in a Sidekiq job:
 *        `app/jobs/attachments/fix_audio_blob_mime_job.rb`.
 *   3. Expose an admin-only controller:
 *        `app/controllers/api/v1/accounts/admin/audio_maintenance_controller.rb`
 *      with `POST :repair_mime` and `GET :status`.
 *   4. Mount under `/api/v1/accounts/:account_id/admin/audio_maintenance/...`.
 *   5. Then re-enable the tools listed above in this module.
 *
 * Until that controller exists, this module registers ZERO tools.
 */

import type { RegisterFn } from "../types.js";

export const register: RegisterFn = (_server, _client) => {
  // No tools registered — audio normalization is a transparent concern +
  // initializer + rake task with no HTTP surface today. See file header
  // for the recommended controller and the tools we'd register once it
  // exists.
};
