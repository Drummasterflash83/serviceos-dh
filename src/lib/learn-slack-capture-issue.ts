/** Fixed copy only: never render raw provider errors or message content here. */
export function slackCaptureIssue(code: string | null | undefined): string | null {
  switch (code) {
    case 'slack_history_content_unavailable':
      return 'Slack has withheld some message content. This window is incomplete; OpenFolk can review the Slack access restriction. Previously saved history is retained.';
    case 'slack_history_message_subtype_unsupported':
    case 'slack_history_message_shape_unsupported':
      return 'This window contains a message format that needs connector support before the import can continue. OpenFolk can review it; previously saved history is retained.';
    default:
      return null;
  }
}
