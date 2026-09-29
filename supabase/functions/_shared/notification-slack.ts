export const OPENFOLK_TEAM = "T0BLG3N4KN1";
export const notificationEvents = [
  {
    key: "practice_feedback",
    label: "Emma test reports",
    module: "AI receptionist",
    detail: "Practice-call feedback and its transcript.",
  },
  {
    key: "receptionist_feedback",
    label: "Emma observations & responses",
    module: "AI receptionist",
    detail: "Client observations and updates to their feedback.",
  },
  {
    key: "urgent_feedback",
    label: "Urgent Emma feedback",
    module: "AI receptionist",
    detail: "Reports marked urgent. This is not continuous outage detection.",
  },
  {
    key: "module_updates",
    label: "Module updates",
    module: "Modules",
    detail: "Published changes to the client programme record.",
  },
  {
    key: "module_feedback",
    label: "Module feedback",
    module: "Modules",
    detail: "Notes submitted through the client programme.",
  },
] as const;
export function notificationEvent(source: string, priority: string, practice: boolean) {
  if (source === "receptionist_feedback")
    return priority === "urgent"
      ? "urgent_feedback"
      : practice
        ? "practice_feedback"
        : "receptionist_feedback";
  if (source === "programme_updated") return "module_updates";
  if (source === "programme_note") return "module_feedback";
  return null;
}
export class SlackRejected extends Error {}
export async function slackRequest(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
) {
  const r = await fetcher(`https://slack.com/api/${method}`, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(r.status))
    throw new SlackRejected(
      "Slack refused the request. Check the bot permissions and channel membership.",
    );
  if (!r.ok) throw Error("Slack could not confirm the request.");
  const data = await r.json();
  if (data.ok !== true) {
    if (
      [
        "invalid_auth",
        "token_revoked",
        "account_inactive",
        "missing_scope",
        "no_permission",
        "channel_not_found",
        "not_in_channel",
        "is_archived",
        "restricted_action",
        "rate_limited",
        "invalid_arguments",
        "msg_too_long",
        "no_text",
      ].includes(data.error)
    )
      throw new SlackRejected(
        "Slack refused the request. Check the bot permissions and channel membership.",
      );
    throw Error("Slack could not confirm the request.");
  }
  return data;
}
export async function verifySlackBot(token: string, fetcher: typeof fetch = fetch) {
  if (!token.startsWith("xoxb-") || token.length > 1000)
    throw Error("Use a Slack bot token, not a personal token or webhook.");
  const auth = await slackRequest(token, "auth.test", {}, fetcher);
  if (auth.team_id !== OPENFOLK_TEAM || typeof auth.bot_id !== "string")
    throw Error("This bot must belong to the OpenFolk Slack workspace.");
  return {
    team_id: auth.team_id as string,
    team_name: String(auth.team ?? "OpenFolk"),
    bot_id: auth.bot_id as string,
  };
}
export function safeSlackChannel(c: Record<string, unknown>) {
  return (
    typeof c.id === "string" &&
    /^[CG][A-Z0-9]+$/.test(c.id) &&
    typeof c.name === "string" &&
    c.is_member === true &&
    c.is_archived === false &&
    c.is_shared === false &&
    c.is_ext_shared === false &&
    c.is_org_shared !== true &&
    c.is_pending_ext_shared !== true &&
    c.is_im !== true &&
    c.is_mpim !== true
  );
}
export async function verifySlackChannel(
  token: string,
  channel: string,
  fetcher: typeof fetch = fetch,
) {
  await verifySlackBot(token, fetcher);
  if (!/^[CG][A-Z0-9]+$/.test(channel)) throw Error("Choose a Slack channel.");
  const data = await slackRequest(token, "conversations.info", { channel }, fetcher);
  if (data.channel?.id !== channel || !safeSlackChannel(data.channel))
    throw Error(
      "Use an internal OpenFolk channel with the bot added. Shared or archived channels are not available.",
    );
  return { id: channel, name: String(data.channel.name) };
}
export async function sendSlackMessage(
  token: string,
  channel: string,
  text: string,
  reference: string,
  fetcher: typeof fetch = fetch,
) {
  const data = await slackRequest(
    token,
    "chat.postMessage",
    {
      channel,
      text,
      client_msg_id: reference,
      parse: "none",
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
    },
    fetcher,
  );
  if (data.channel !== channel || typeof data.ts !== "string" || !/^\d+\.\d+$/.test(data.ts))
    throw Error("Slack delivery receipt could not be verified.");
  return { channel, ts: data.ts as string };
}
