/**
 * Aggregator — imports each tool module and calls its `register` function
 * with the shared MCP server + NooviChat client.
 *
 * NOTE: each module is responsible for registering its own tools via
 * `server.registerTool(...)`. Adding a new resource = adding a new
 * import + entry below. Order is irrelevant.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NooviChatClient } from "../client.js";

import { register as registerPipelineActivities } from "./pipeline-activities.js";
import { register as registerPipelineAutomations } from "./pipeline-automations.js";
import { register as registerPipelineCards } from "./pipeline-cards.js";
import { register as registerPipelineSequences } from "./pipeline-sequences.js";
import { register as registerPipelineWebhooks } from "./pipeline-webhooks.js";
// ── Pipeline Pro (NooviChat flagship) ────────────────────────────────────────
import { register as registerPipelines } from "./pipelines.js";

import { register as registerAppointments } from "./appointments.js";
// ── Follow-ups & Atendimentos ────────────────────────────────────────────────
import { register as registerFollowUps } from "./follow-ups.js";

// ── Broadcasts & WhatsApp ─────────────────────────────────────────────────────
import { register as registerBroadcasts } from "./broadcasts.js";
import { register as registerUazapi } from "./uazapi.js";
import { register as registerWaha } from "./waha.js";
import { register as registerWhatsappHub } from "./whatsapp-hub.js";
import { register as registerWhatsappTemplates } from "./whatsapp-templates.js";

// ── CRM & lead management ─────────────────────────────────────────────────────
import { register as registerCommercialAnalyses } from "./commercial-analyses.js";
import { register as registerCompanies } from "./companies.js";
import { register as registerInternalChat } from "./internal-chat.js";
import { register as registerLeadScoring } from "./lead-scoring.js";

// ── Atendimento extensions (Cat A) ────────────────────────────────────────────
import { register as registerAtendimentoExt } from "./atendimento-extensions.js";

// ── Cat B confirmadas (custom NooviChat) ──────────────────────────────────────
import { register as registerGoogleCalendar } from "./google-calendar.js";

import { register as registerAudio } from "./audio.js";
import { register as registerCaptainAi } from "./captain-ai.js";
import { register as registerCaptainHook } from "./captain-hook.js";
import { register as registerConversationSummary } from "./conversation-summary.js";
import { register as registerFlowBuilder } from "./flow-builder.js";
// ── Admin / diagnostic ────────────────────────────────────────────────────────
// NOTE: the NooviChat licensing and operational authorization boundary is
// deliberately NOT exposed as MCP tools; it must not be readable or mutable by
// API clients or LLMs.
import { register as registerWhitelabel } from "./whitelabel.js";

const registrations = [
  registerPipelines,
  registerPipelineCards,
  registerPipelineAutomations,
  registerPipelineActivities,
  registerPipelineSequences,
  registerPipelineWebhooks,
  registerFollowUps,
  registerAppointments,
  registerBroadcasts,
  registerWhatsappTemplates,
  registerWhatsappHub,
  registerWaha,
  registerUazapi,
  registerLeadScoring,
  registerCommercialAnalyses,
  registerCompanies,
  registerInternalChat,
  registerAtendimentoExt,
  registerGoogleCalendar,
  registerFlowBuilder,
  registerWhitelabel,
  registerCaptainHook,
  registerCaptainAi,
  registerConversationSummary,
  registerAudio,
];

export function registerAllTools(server: McpServer, client: NooviChatClient): void {
  for (const register of registrations) {
    register(server, client);
  }
}
