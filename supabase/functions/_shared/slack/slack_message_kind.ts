import {SlackHistoryTransportError} from './slack_history_errors.ts';
/** History contains conversation content and channel activity. Activity is kept
 * as source evidence, but must not become a conversation/performance observation.
 * https://docs.slack.dev/reference/events/message/ */
const conversation = new Set(['bot_message', 'thread_broadcast', 'me_message',
  'file_share', 'file_comment', 'file_mention']);
const activity = new Set(['channel_archive', 'channel_unarchive', 'channel_join',
  'channel_leave', 'channel_name', 'channel_purpose', 'channel_topic',
  'channel_posting_permissions', 'channel_convert_to_private', 'channel_convert_to_public',
  'group_archive', 'group_unarchive', 'group_join', 'group_leave', 'group_name',
  'group_purpose', 'group_topic', 'pinned_item', 'unpinned_item']);
function unsupported(message: Record<string, unknown>, code: string): never {
  const error = new SlackHistoryTransportError(code, false);
  // Structural labels only: never persist text, identities, files or raw values.
  error.diagnostic = Object.freeze({
    version: 'slack-structure/1', code,
    type: message.type === undefined ? 'missing' : message.type === 'message' ? 'message' : 'other',
    hidden: message.hidden === undefined ? 'missing' : message.hidden === true ? 'true' : message.hidden === false ? 'false' : 'other',
    subtypeType: message.subtype === undefined ? 'missing' : typeof message.subtype === 'string' ? 'string' : 'other',
    subtype: typeof message.subtype === 'string' && /^[a-z_]{1,64}$/.test(message.subtype) ? message.subtype : null,
  });
  throw error;
}
export function slackMessageKind(message: Record<string, unknown>): 'conversation' | 'channel_activity' | 'source_needs_review' | 'source_withheld' {
  // Exact observed provider withholding marker; never blanket-admit hidden records.
  if (message.type === 'message' && message.subtype === 'tombstone' && message.hidden === true) return 'source_withheld';
  if (message.type !== undefined && message.type !== 'message' ||
      message.hidden !== undefined && message.hidden !== false ||
      message.subtype !== undefined && typeof message.subtype !== 'string') {
    unsupported(message, 'slack_history_message_shape_unsupported');
  }
  if (message.subtype === undefined || conversation.has(message.subtype as string)) return 'conversation';
  if (activity.has(message.subtype as string)) return 'channel_activity';
  // Fail without advancing the checkpoint: unknown, redacted or event-envelope
  // data is not silently skipped or reported as captured conversation content.
  // Observed provider subtype, undocumented in the reviewed official reference.
  // Retain it for review; do not infer activity or conversation semantics.
  if (message.subtype === 'welcome_party' || message.subtype === 'tabbed_canvas_updated' || message.subtype === 'automatic_ai_huddle_notes_enabled' || message.subtype === 'huddle_thread') return 'source_needs_review';
  if (message.subtype === 'ekm_access_denied') throw new SlackHistoryTransportError('slack_history_content_unavailable', false);
  unsupported(message, 'slack_history_message_subtype_unsupported');
}
