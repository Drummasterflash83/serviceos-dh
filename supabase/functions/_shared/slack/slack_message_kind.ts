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
export function slackMessageKind(message: Record<string, unknown>): 'conversation' | 'channel_activity' {
  if (message.type !== undefined && message.type !== 'message' ||
      message.hidden !== undefined && message.hidden !== false ||
      message.subtype !== undefined && typeof message.subtype !== 'string') {
    throw new SlackHistoryTransportError('slack_history_message_shape_unsupported', false);
  }
  if (message.subtype === undefined || conversation.has(message.subtype as string)) return 'conversation';
  if (activity.has(message.subtype as string)) return 'channel_activity';
  // Fail without advancing the checkpoint: unknown, redacted or event-envelope
  // data is not silently skipped or reported as captured conversation content.
  if (message.subtype === 'ekm_access_denied') throw new SlackHistoryTransportError('slack_history_content_unavailable', false);
  throw new SlackHistoryTransportError('slack_history_message_subtype_unsupported', false);
}
