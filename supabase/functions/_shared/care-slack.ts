// Never trust a channel label or a webhook's HTTP 200 as destination verification.
type SlackFetch = typeof fetch;
export async function verifyCareChannel(
  token: string,
  allowedTeam: string,
  team: string,
  channel: string,
  fetcher: SlackFetch = fetch,
) {
  if (!token || !allowedTeam || team !== allowedTeam || !/^C[A-Z0-9]+$/.test(channel))
    throw Error("slack_destination_unapproved");
  const request = async (method: string, params: Record<string, string>) => {
    const r = await fetcher(`https://slack.com/api/${method}`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("slack_unavailable");
    const body = await r.json();
    if (body.ok !== true) throw Error("slack_verification_failed");
    return body;
  };
  const auth = await request("auth.test", {});
  if (auth.team_id !== allowedTeam) throw Error("slack_workspace_mismatch");
  const info = await request("conversations.info", { channel });
  if (
    info.channel?.id !== channel ||
    info.channel.is_archived ||
    info.channel.is_ext_shared ||
    info.channel.is_shared ||
    info.channel.is_member !== true
  )
    throw Error("slack_channel_not_available");
  return {
    team_id: auth.team_id,
    channel_id: info.channel.id,
    name: String(info.channel.name),
    user_id: typeof auth.user_id === "string" ? auth.user_id : null,
    bot_id: typeof auth.bot_id === "string" ? auth.bot_id : null,
  };
}

/** A confirmed rejection is retryable; transport uncertainty must be reconciled first. */
export class SlackRejectedDelivery extends Error {
  constructor() {
    super("slack_delivery_failed");
    this.name = "SlackRejectedDelivery";
  }
}
// Do not classify internal_error/fatal_error/request_timeout as a definite non-send.
const definiteRejections = new Set([
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "no_permission",
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "restricted_action",
  "restricted_action_read_only_channel",
  "ekm_access_denied",
  "rate_limited",
  "ratelimited",
  "invalid_arguments",
  "invalid_arg_name",
  "invalid_form_data",
  "invalid_post_type",
  "invalid_charset",
  "invalid_blocks",
  "invalid_blocks_format",
  "invalid_metadata_format",
  "invalid_metadata_schema",
  "msg_too_long",
  "no_text",
  "too_many_attachments",
  "invalid_thread_ts",
  "thread_not_found",
]);
export async function postCareAlert(input: {
  token: string;
  channel: string;
  text: string;
  reference: string;
  thread?: string;
  fetcher?: SlackFetch;
}) {
  const r = await (input.fetcher ?? fetch)("https://slack.com/api/chat.postMessage", {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      thread_ts: input.thread,
      client_msg_id: input.reference,
      parse: "none",
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(r.status))
      throw new SlackRejectedDelivery();
    throw Error("slack_delivery_failed");
  }
  const data = await r.json();
  if (data.ok === false && typeof data.error === "string" && definiteRejections.has(data.error))
    throw new SlackRejectedDelivery();
  if (data.ok !== true || data.channel !== input.channel || typeof data.ts !== "string")
    throw Error("slack_receipt_invalid");
  return { channel: data.channel, ts: data.ts };
}
export const slackEscape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
