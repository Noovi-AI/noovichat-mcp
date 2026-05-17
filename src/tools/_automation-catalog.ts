/**
 * Pipeline-automation vocabulary catalog.
 *
 * The NooviChat automation engine (Chatwoot `app/services/pipeline_automations/`)
 * has no metadata endpoint — the trigger / condition / action vocabulary is
 * defined statically in Rails. This module mirrors it so the MCP can:
 *   - validate flows client-side (typed enums),
 *   - expose the vocabulary to an LLM via `get_automation_catalog`,
 *   - assemble valid flows via `build_automation_flow`.
 *
 * KEEP IN SYNC with:
 *   Chatwoot/app/services/pipeline_automations/execution_service.rb  (triggers, conditions)
 *   Chatwoot/app/services/pipeline_automations/actions/*.rb          (actions + params)
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Triggers — what starts a flow                                              */
/* -------------------------------------------------------------------------- */

export interface TriggerDef {
  event_type: string;
  domain: "conversation" | "contact" | "pipeline" | "system";
  summary: string;
}

export const TRIGGERS: TriggerDef[] = [
  {
    event_type: "conversation_created",
    domain: "conversation",
    summary: "A new conversation is created",
  },
  {
    event_type: "conversation_status_changed",
    domain: "conversation",
    summary: "Conversation status changes (open/resolved/pending/snoozed)",
  },
  {
    event_type: "conversation_label_changed",
    domain: "conversation",
    summary: "A label is added to / removed from a conversation",
  },
  {
    event_type: "message_received",
    domain: "conversation",
    summary: "An incoming message is received",
  },
  {
    event_type: "first_reply_created",
    domain: "conversation",
    summary: "The first agent reply is sent",
  },
  {
    event_type: "assignee_changed",
    domain: "conversation",
    summary: "The conversation assignee changes",
  },
  { event_type: "team_changed", domain: "conversation", summary: "The conversation team changes" },
  {
    event_type: "conversation_mentioned",
    domain: "conversation",
    summary: "An agent is mentioned in a conversation",
  },
  { event_type: "contact_created", domain: "contact", summary: "A new contact is created" },
  { event_type: "contact_updated", domain: "contact", summary: "A contact is updated" },
  {
    event_type: "pipeline_item_created",
    domain: "pipeline",
    summary: "A pipeline card is created (alias: item_created)",
  },
  {
    event_type: "pipeline_item_moved",
    domain: "pipeline",
    summary: "A card moves to another stage (alias: item_moved)",
  },
  {
    event_type: "pipeline_item_status_changed",
    domain: "pipeline",
    summary: "A card status changes (alias: status_changed)",
  },
  { event_type: "pipeline_card_won", domain: "pipeline", summary: "A card is marked won" },
  { event_type: "pipeline_card_lost", domain: "pipeline", summary: "A card is marked lost" },
  {
    event_type: "pipeline_card_owner_changed",
    domain: "pipeline",
    summary: "A card owner changes",
  },
  { event_type: "scheduled", domain: "system", summary: "Time-based trigger (cron-like schedule)" },
  { event_type: "webhook", domain: "system", summary: "An inbound webhook call triggers the flow" },
];

// Includes aliases accepted by the engine's start-node detection.
export const TRIGGER_EVENT_TYPES = [
  "conversation_created",
  "conversation_status_changed",
  "conversation_label_changed",
  "message_received",
  "first_reply_created",
  "assignee_changed",
  "team_changed",
  "conversation_mentioned",
  "contact_created",
  "contact_updated",
  "pipeline_item_created",
  "pipeline_item_moved",
  "pipeline_item_status_changed",
  "pipeline_card_won",
  "pipeline_card_lost",
  "pipeline_card_owner_changed",
  "item_created",
  "item_moved",
  "status_changed",
  "scheduled",
  "webhook",
] as const;

export const triggerEventTypeEnum = z
  .enum(TRIGGER_EVENT_TYPES)
  .describe("Event that starts the automation. See get_automation_catalog for details.");

/* -------------------------------------------------------------------------- */
/* Conditions — branch the flow                                               */
/* -------------------------------------------------------------------------- */

export interface ConditionDef {
  type: string;
  summary: string;
  params: Record<string, string>;
}

export const CONDITIONS: ConditionDef[] = [
  {
    type: "has_label",
    summary: "True when the conversation has a given label",
    params: { label: "Label slug/title to check" },
  },
  {
    type: "text_contains",
    summary: "True when message text contains a substring",
    params: { text: "Substring to look for" },
  },
  {
    type: "status_equals",
    summary: "True when conversation status equals a value",
    params: { status: "open | resolved | pending | snoozed" },
  },
  {
    type: "assigned_to",
    summary: "True when assigned to a given agent",
    params: { agent_id: "Agent (User) ID" },
  },
  {
    type: "priority_is",
    summary: "True when conversation priority matches",
    params: { priority: "low | medium | high | urgent" },
  },
  {
    type: "if",
    summary: "Generic boolean branch (params depend on the FlowBuilder expression)",
    params: {},
  },
  { type: "branch", summary: "Multi-way branch node", params: {} },
];

export const CONDITION_TYPES = [
  "has_label",
  "text_contains",
  "status_equals",
  "assigned_to",
  "priority_is",
  "if",
  "branch",
  "condition",
] as const;

export const conditionTypeEnum = z.enum(CONDITION_TYPES).describe("Condition node type");

/* -------------------------------------------------------------------------- */
/* Actions — what the flow does (cross-feature surface)                        */
/* -------------------------------------------------------------------------- */

export interface ActionDef {
  type: string;
  domain:
    | "conversation"
    | "contact"
    | "pipeline"
    | "messaging"
    | "ai"
    | "calendar"
    | "task"
    | "control";
  summary: string;
  params: Record<string, string>;
}

export const ACTIONS: ActionDef[] = [
  // ── conversation ──────────────────────────────────────────────────────────
  {
    type: "add_label",
    domain: "conversation",
    summary: "Add a label to the conversation",
    params: { label: "Label slug/title" },
  },
  {
    type: "remove_label",
    domain: "conversation",
    summary: "Remove a label from the conversation",
    params: { label: "Label slug/title" },
  },
  {
    type: "add_tag",
    domain: "conversation",
    summary: "Add a tag / custom attribute",
    params: { name: "Tag name", value: "Optional value" },
  },
  {
    type: "add_note",
    domain: "conversation",
    summary: "Add a private note",
    params: { content: "Note text", mention_assignee: "Optional boolean" },
  },
  {
    type: "send_message",
    domain: "conversation",
    summary: "Send a message in the conversation",
    params: {
      content: "Message text",
      message_type: "outgoing | template",
      private: "Optional boolean",
    },
  },
  {
    type: "send_attachment",
    domain: "conversation",
    summary: "Send a file attachment",
    params: { file_url: "Public file URL", content: "Optional caption" },
  },
  {
    type: "change_status",
    domain: "conversation",
    summary: "Change conversation status",
    params: { status: "open | resolved | pending | snoozed" },
  },
  {
    type: "change_priority",
    domain: "conversation",
    summary: "Change conversation priority",
    params: { priority: "low | medium | high | urgent" },
  },
  {
    type: "resolve_conversation",
    domain: "conversation",
    summary: "Resolve the conversation",
    params: { message: "Optional resolution message", send_resolution_message: "Optional boolean" },
  },
  {
    type: "reopen_conversation",
    domain: "conversation",
    summary: "Reopen the conversation",
    params: { notify_agent: "Optional boolean" },
  },
  {
    type: "snooze_conversation",
    domain: "conversation",
    summary: "Snooze the conversation",
    params: { duration: "Number", unit: "minutes | hours | days", until: "Optional ISO8601" },
  },
  {
    type: "mute_conversation",
    domain: "conversation",
    summary: "Mute the conversation",
    params: {},
  },
  {
    type: "unmute_conversation",
    domain: "conversation",
    summary: "Unmute the conversation",
    params: {},
  },
  {
    type: "assign_agent",
    domain: "conversation",
    summary: "Assign the conversation to an agent",
    params: { agent_id: "Agent (User) ID", assignment_type: "Optional: specific | round_robin" },
  },
  {
    type: "assign_team",
    domain: "conversation",
    summary: "Assign the conversation to a team",
    params: { team_id: "Team ID", notify: "Optional boolean" },
  },
  {
    type: "transfer_to_inbox",
    domain: "conversation",
    summary: "Move the conversation to another inbox",
    params: { inbox_id: "Target inbox ID", keep_assignee: "Optional boolean" },
  },
  {
    type: "set_conversation_attribute",
    domain: "conversation",
    summary: "Set conversation custom attributes",
    params: { attributes: "Object of key/value pairs" },
  },
  {
    type: "send_csat_survey",
    domain: "conversation",
    summary: "Send a CSAT survey",
    params: { message: "Optional message", only_if_resolved: "Optional boolean" },
  },
  // ── contact ───────────────────────────────────────────────────────────────
  {
    type: "update_contact",
    domain: "contact",
    summary: "Update the contact's attributes",
    params: { custom_attributes: "Object", additional_attributes: "Object" },
  },
  // ── pipeline ──────────────────────────────────────────────────────────────
  {
    type: "move_to_stage",
    domain: "pipeline",
    summary: "Move the pipeline card to a stage",
    params: { stage_name: "Stage name (or stage: stage key)" },
  },
  {
    type: "create_pipeline_card",
    domain: "pipeline",
    summary: "Create a pipeline card",
    params: {
      pipeline_id: "Pipeline ID",
      stage_id: "Stage key",
      title: "Card title",
      value: "Optional revenue",
      link_to_conversation: "Optional boolean",
    },
  },
  // ── messaging ─────────────────────────────────────────────────────────────
  {
    type: "send_whatsapp_template",
    domain: "messaging",
    summary: "Send an approved WhatsApp template",
    params: {
      template_name: "Template name",
      language: "e.g. pt_BR",
      template_params: "Array/object of params",
    },
  },
  {
    type: "send_whatsapp_media",
    domain: "messaging",
    summary: "Send WhatsApp media",
    params: {
      media_url: "Public media URL",
      media_type: "image | video | audio | document",
      caption: "Optional caption",
    },
  },
  {
    type: "send_notification",
    domain: "messaging",
    summary: "Send an in-app notification to agents/teams",
    params: {
      content: "Notification text",
      recipient_type: "agents | team",
      agent_ids: "Array",
      team_id: "Team ID",
    },
  },
  {
    type: "send_email_to_team",
    domain: "messaging",
    summary: "Email a team",
    params: { team_ids: "Array of team IDs", content: "Email body" },
  },
  {
    type: "send_email_transcript",
    domain: "messaging",
    summary: "Email the conversation transcript",
    params: { email: "Recipient email" },
  },
  // ── ai ────────────────────────────────────────────────────────────────────
  {
    type: "call_captain_ai",
    domain: "ai",
    summary: "Run a Captain AI operation (summarize, reply, classify…)",
    params: {
      operation: "Operation key",
      prompt: "Optional prompt",
      model: "Optional model",
      send_as_message: "Optional boolean",
    },
  },
  // ── calendar ──────────────────────────────────────────────────────────────
  {
    type: "create_google_event",
    domain: "calendar",
    summary: "Create a Google Calendar event",
    params: {
      title: "Event title",
      start_time: "ISO8601",
      duration_minutes: "Number",
      add_meet_link: "Optional boolean",
      include_contact: "Optional boolean",
    },
  },
  // ── task ──────────────────────────────────────────────────────────────────
  {
    type: "create_task",
    domain: "task",
    summary: "Create an internal task",
    params: {
      title: "Task title",
      description: "Optional",
      assignee_id: "Optional agent ID",
      due_at: "Optional ISO8601",
    },
  },
  // ── control ───────────────────────────────────────────────────────────────
  {
    type: "wait",
    domain: "control",
    summary: "Pause the flow before the next node",
    params: { duration: "Number", unit: "minutes | hours | days" },
  },
  {
    type: "http_request",
    domain: "control",
    summary: "Make an outbound HTTP request",
    params: {
      url: "Target URL",
      method: "GET | POST | PUT | PATCH | DELETE",
      headers: "Optional object",
      body: "Optional payload",
    },
  },
  {
    type: "trigger_webhook",
    domain: "control",
    summary: "Call a webhook with flow context",
    params: {
      url: "Webhook URL",
      event: "Optional event name",
      include_conversation: "Optional boolean",
      include_contact: "Optional boolean",
    },
  },
];

export const ACTION_TYPES = ACTIONS.map((a) => a.type) as [string, ...string[]];

export const actionTypeEnum = z
  .enum(ACTION_TYPES)
  .describe("Action node type. See get_automation_catalog for each action's params.");

/* -------------------------------------------------------------------------- */
/* Node category enum                                                         */
/* -------------------------------------------------------------------------- */

export const NODE_CATEGORIES = [
  "trigger",
  "condition",
  "action",
  "loop",
  "split",
  "annotation",
] as const;
