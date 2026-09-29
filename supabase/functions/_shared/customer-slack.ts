import { OPENFOLK_TEAM, slackRequest, safeSlackChannel } from "./notification-slack.ts";
export const customerEvents = [
  {
    key: "progress",
    label: "Feedback progress",
    detail: "When a report is submitted or moves into review.",
  },
  {
    key: "resolved",
    label: "Resolved reports",
    detail: "When OpenFolk confirms that the work is finished.",
  },
  {
    key: "urgent",
    label: "Urgent issues",
    detail: "Updates on feedback marked urgent. This is not an outage-monitoring service.",
  },
] as const;
export async function customerBot(
  token: string,
  expectedTeam?: string,
  fetcher: typeof fetch = fetch,
) {
  if (!token.startsWith("xoxb-") || token.length > 1000) throw Error("Invalid bot token");
  const a = await slackRequest(token, "auth.test", {}, fetcher);
  if (
    typeof a.team_id !== "string" ||
    !/^T[A-Z0-9]+$/.test(a.team_id) ||
    a.team_id === OPENFOLK_TEAM ||
    typeof a.bot_id !== "string" ||
    (expectedTeam && a.team_id !== expectedTeam)
  )
    throw Error("Client workspace mismatch");
  return {
    team_id: a.team_id as string,
    team_name: String(a.team ?? "Your Slack"),
    bot_id: a.bot_id as string,
  };
}
export async function customerChannel(
  token: string,
  team: string,
  channel: string,
  fetcher: typeof fetch = fetch,
) {
  await customerBot(token, team, fetcher);
  if (!/^[CG][A-Z0-9]+$/.test(channel)) throw Error("Invalid channel");
  const r = await slackRequest(token, "conversations.info", { channel }, fetcher);
  if (r.channel?.id !== channel || !safeSlackChannel(r.channel))
    throw Error("Use an internal channel with the bot invited");
  return { id: channel, name: String(r.channel.name) };
}
// No caller names, recordings, transcript, proposal or internal operator details.
export function customerNotificationText(job: {
  tenant_id: string;
  client_stage: string;
  event_key: string;
}) {
  const message =
    job.client_stage === "resolved"
      ? "Resolved — OpenFolk has completed your feedback report."
      : job.client_stage === "submitted"
        ? "Submitted — your report is saved for OpenFolk to review."
        : "In review — OpenFolk is working through your report. We’ll confirm here when it is resolved.";
  return `${job.event_key === "urgent" ? "Urgent · " : ""}Emma feedback\n${message}\nView your feedback in your private workspace:\nhttps://app.openfolk.ai/client?tenant=${encodeURIComponent(job.tenant_id)}&section=receptionist&view=improvements`;
}
