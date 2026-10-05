import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, MessageSquare, Send } from "lucide-react";
import { OperatorShell } from "@/components/app/OperatorShell";
import { useAuth } from "@/lib/auth";
import { listTenantDirectory } from "@/lib/openfolk";
import { providerUsageSearch } from "@/lib/provider-usage";
import { findOperatorTenant } from "@/lib/operator-workspace";
import { sectionSearchValue } from "@/lib/openfolk-workspace-nav";
import {
  notificationRequest,
  notificationDeliveryLabel,
  type NotificationStatus,
  type NotificationRoute,
  type SlackChannelPage,
} from "@/lib/operator-notifications";
import "@/styles/operator-notifications.css";

export const Route = createFileRoute("/openfolk/notifications")({
  validateSearch: providerUsageSearch,
  component: Notifications,
});
function Notifications() {
  const { user } = useAuth();
  const { tenant: selected } = Route.useSearch();
  const navigate = Route.useNavigate();
  const directory = useQuery({
    queryKey: ["operator-directory", user?.id],
    queryFn: async () => {
      const result = await listTenantDirectory();
      if (!result.ok) throw Error("OpenFolk operator access is required.");
      return result.data.tenants;
    },
  });
  const tenant =
    directory.isSuccess && !directory.isError
      ? selected
        ? findOperatorTenant(directory.data, selected)
        : directory.data[0]
      : undefined;
  return (
    <OperatorShell
      pageTitle="Notifications"
      tenantId={tenant?.tenant_id}
      company={tenant ? (tenant.display_name ?? tenant.slug ?? "Client workspace") : undefined}
      onModule={(module) => {
        if (tenant)
          void navigate({
            to: "/openfolk/$tenantId",
            params: { tenantId: tenant.slug ?? tenant.tenant_id },
            search: { module, tools: false },
          });
      }}
      onSection={(section) => {
        if (tenant)
          void navigate({
            to: "/openfolk/$tenantId",
            params: { tenantId: tenant.slug ?? tenant.tenant_id },
            search: { section: sectionSearchValue(section), tools: true },
          });
      }}
    >
      <div className="op-heading">
        <p className="op-eyebrow">NOTIFICATIONS · SLACK</p>
        <h1>The right update. In the right place.</h1>
        <p>Choose where your team receives feedback and updates. Keep every client in view.</p>
      </div>
      <section className="op-card nt-client">
        <label htmlFor="notification-client">Client</label>
        <select
          id="notification-client"
          value={tenant?.tenant_id ?? ""}
          onChange={(e) => void navigate({ search: { tenant: e.target.value } })}
        >
          {!tenant && <option value="">Choose an accessible client</option>}
          {directory.data?.map((t) => (
            <option key={t.tenant_id} value={t.tenant_id}>
              {t.display_name ?? t.slug}
            </option>
          ))}
        </select>
      </section>
      {directory.isPending && <p role="status">Loading your clients…</p>}
      {directory.isError && (
        <p className="op-error" role="alert">
          {directory.error.message}
        </p>
      )}
      {directory.isSuccess && !tenant && <p>Choose a client to see its notification settings.</p>}
      {tenant && (
        <SlackSettings
          key={`${user?.id}:${tenant.tenant_id}`}
          tenantId={tenant.tenant_id}
          userId={user?.id ?? ""}
        />
      )}
      <p className="op-note nt-future">
        <Bell size={16} /> Email, SMS and other notification channels will appear here when
        connected.
      </p>
    </OperatorShell>
  );
}
function SlackSettings({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: ["operator-notifications", userId, tenantId],
    queryFn: () => notificationRequest<NotificationStatus>({ action: "status", tenantId }),
    refetchInterval: 30000,
    retry: false,
  });
  const channels = useInfiniteQuery({
    queryKey: ["operator-slack-channels", userId, tenantId, status.data?.connection?.connected_at],
    enabled: Boolean(status.data?.connection),
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      notificationRequest<SlackChannelPage>({ action: "channels", tenantId, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor || undefined,
    retry: false,
  });
  const allChannels = [
    ...new Map(
      (channels.data?.pages.flatMap((p) => p.channels) ?? []).map((c) => [c.id, c]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const token = String(new FormData(form).get("botToken") ?? "").trim();
    form.reset(); // Never persist a credential in React Query, local storage or a URL.
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await notificationRequest({ action: "connect", tenantId, botToken: token });
      setMessage("OpenFolk Slack connected. Choose and test your destinations below.");
      await status.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }
  async function save(eventKey: string, channelId: string, version: number) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await notificationRequest<{ channel: { name: string } }>({
        action: "save_route",
        tenantId,
        eventKey,
        channelId,
        version,
      });
      setMessage(
        `Test delivered. New ${status.data?.events.find((e) => e.key === eventKey)?.label.toLowerCase()} will go to #${result.channel.name}. Messages already being sent keep their original destination.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The destination could not be saved.");
    } finally {
      await status.refetch();
      setBusy(false);
    }
  }
  if (status.isPending) return <p role="status">Loading notifications…</p>;
  if (status.isError)
    return (
      <div className="op-error" role="alert">
        {status.error.message} <button onClick={() => void status.refetch()}>Retry</button>
      </div>
    );
  const data = status.data;
  return (
    <div className="nt-settings">
      <section className="op-card nt-connection">
        <div>
          <h2>
            <MessageSquare size={22} /> OpenFolk Slack
          </h2>
          <p>
            {data.connection
              ? `Connected to ${data.connection.team_name}. Channel access is checked before every send.`
              : "Connect once. Choose a channel for each kind of update."}
          </p>
          <span className={`nt-badge ${data.connection ? "is-ready" : ""}`}>
            {data.connection ? "Bot connected" : "Awaiting bot connection"}
          </span>
        </div>
        <details>
          <summary>{data.connection ? "Manage connection" : "Connect Slack"}</summary>
          <p>
            Create or use an OpenFolk Slack app with <code>chat:write</code>,{" "}
            <code>channels:read</code> and <code>groups:read</code>. Install it in OpenFolk and
            invite its bot to the channels you want to use. No message-history permission is needed.
          </p>
          <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
            Open Slack app settings ↗
          </a>
          <form onSubmit={connect}>
            <label htmlFor="notification-bot-token">
              Bot token — stored encrypted on the server
            </label>
            <input
              id="notification-bot-token"
              name="botToken"
              type="password"
              autoComplete="off"
              placeholder="xoxb-…"
              required
              maxLength={1000}
            />
            <button className="op-button" disabled={busy}>
              {busy ? "Checking…" : "Verify & connect"}
            </button>
          </form>
          <p className="op-note">
            One connection serves OpenFolk’s clients. Never send this token in chat. Connecting does
            not move existing notifications; test and save each route below.
          </p>
        </details>
      </section>
      {message && (
        <p className="nt-success" role="status">
          <CheckCircle2 size={20} />
          {message}
        </p>
      )}
      {error && (
        <p className="op-error" role="alert">
          {error}
        </p>
      )}
      <div className="nt-section-title">
        <h2>Where updates go</h2>
        <p>Only internal OpenFolk channels that include the bot are available.</p>
      </div>
      {channels.isError && (
        <p className="op-error" role="alert">
          {channels.error.message}{" "}
          <button onClick={() => void channels.refetch()}>Reload channels</button>
        </p>
      )}
      {data.connection && !channels.isError && (
        <div className="nt-channel-tools">
          <button
            className="op-button"
            disabled={channels.isFetching}
            onClick={() => void channels.refetch()}
          >
            Refresh channel list
          </button>
          {channels.hasNextPage && (
            <button
              className="op-button"
              disabled={channels.isFetching}
              onClick={() => void channels.fetchNextPage()}
            >
              Load more channels
            </button>
          )}
          <span>
            {channels.isFetching
              ? "Checking channels…"
              : `${allChannels.length} available${channels.hasNextPage ? " — more to load" : ""}`}
          </span>
        </div>
      )}
      <div className="nt-routes">
        {data.events.map((event) => (
          <RouteCard
            key={`${event.key}:${data.routes.find((r) => r.event_key === event.key)?.version ?? 0}`}
            event={event}
            route={data.routes.find((r) => r.event_key === event.key)}
            channels={allChannels}
            connected={Boolean(data.connection)}
            legacy={data.legacyConfigured}
            busy={busy || channels.isError}
            onSave={save}
          />
        ))}
      </div>
      <section className="op-card nt-deliveries">
        <h2>Recent deliveries</h2>
        <p>
          Latest 30 queued updates for this client. A saved report is not marked delivered until
          Slack confirms it.
        </p>
        {!data.deliveries.length ? (
          <p>No queued updates yet.</p>
        ) : (
          <ul>
            {data.deliveries.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>
                    {data.events.find((e) => e.key === d.notification_route?.event)?.label ??
                      (d.source_type === "receptionist_feedback"
                        ? "Emma feedback"
                        : "Module update")}
                  </strong>
                  <small>
                    {new Date(d.created_at).toLocaleString("en-GB")} ·{" "}
                    {d.notification_route?.channel_name
                      ? `#${d.notification_route.channel_name}`
                      : "Original webhook destination"}
                  </small>
                </div>
                <span className={`nt-badge ${d.state === "sent" ? "is-ready" : ""}`}>
                  {notificationDeliveryLabel(d)}
                </span>
                {d.slack_channel && d.slack_ts && (
                  <a
                    href={`https://openfolk.slack.com/archives/${d.slack_channel}/p${d.slack_ts.replace(".", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View message ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="op-note">
          Existing webhook destinations cannot be verified by name here. Historic deliveries are not
          re-sent when you change a route.
        </p>
      </section>
    </div>
  );
}
function RouteCard({
  event,
  route,
  channels,
  connected,
  legacy,
  busy,
  onSave,
}: {
  event: NotificationStatus["events"][number];
  route?: NotificationRoute;
  channels: { id: string; name: string }[];
  connected: boolean;
  legacy: boolean;
  busy: boolean;
  onSave: (event: string, channel: string, version: number) => Promise<void>;
}) {
  const [channel, setChannel] = useState(route?.channel_id ?? "");
  return (
    <section className="op-card nt-route">
      <p className="op-eyebrow">{event.module}</p>
      <h3>{event.label}</h3>
      <p>{event.detail}</p>
      <div className="nt-current">
        {route ? (
          <>
            <CheckCircle2 size={17} /> #{route.channel_name}
            <small>Test confirmed {new Date(route.updated_at).toLocaleString("en-GB")}</small>
          </>
        ) : (
          <>
            <span>{legacy ? "Using the existing webhook" : "Awaiting a destination"}</span>
          </>
        )}
      </div>
      <label htmlFor={`route-${event.key}`}>Slack channel</label>
      <select
        id={`route-${event.key}`}
        value={channel}
        disabled={!connected || busy}
        onChange={(e) => setChannel(e.target.value)}
      >
        <option value="">Choose a channel</option>
        {route && !channels.some((c) => c.id === route.channel_id) && (
          <option value={route.channel_id}>#{route.channel_name} — checking access</option>
        )}
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            #{c.name}
          </option>
        ))}
      </select>
      <button
        className="op-button"
        disabled={!connected || busy || !channels.some((c) => c.id === channel)}
        onClick={() => void onSave(event.key, channel, route?.version ?? 0)}
      >
        <Send size={16} /> Send test & use this channel
      </button>
    </section>
  );
}
