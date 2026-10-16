/** Read-only latest retained activity per approved public Slack channel. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const query = `select h.team_id,m.channel_id,a.display_name,
  to_timestamp(max(s.provider_timestamp::numeric)) latest_retained_at
from public.slack_history_campaigns h
join public.slack_history_campaign_channels m on m.campaign_id=h.id
  and m.tenant_id=h.tenant_id
join public.connector_accounts a on a.id=m.account_id and a.tenant_id=m.tenant_id
left join public.slack_messages s on s.tenant_id=h.tenant_id
  and s.team_id=h.team_id and s.channel_id=m.channel_id
where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid
  and m.channel_id like 'C%'
group by h.team_id,m.channel_id,a.display_name
order by latest_retained_at desc nulls last limit 20`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,
  { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
);
if (!response.ok) throw Error(`Approved roster search HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 20 || rows.some((r) =>
  !/^T[A-Z0-9]+$/.test(r.team_id) || !/^C[A-Z0-9]+$/.test(r.channel_id) ||
  typeof r.display_name !== "string"))
  throw Error("Approved roster search shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), rows,
  messageContentReturned: false, productionDataWrites: false }));
