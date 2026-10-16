/** Read-only LIVE comparison of visible current public Drummonds channels. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
// These five current public channel IDs were verified in the signed-in DH UI.
const visible = [
  "C0BTK64KH54", // 11-office-ai
  "C0BJJ2UNHEE", // 03-office-jobprocessing
  "C0B0V2V3ME0", // 01-engineer-today
  "C0B6GJ717GX", // 01-strategy-weekly
  "C0C4WNGDCJK", // 06-finance-debtors
];
const literals = visible.map((id) => `'${id}'`).join(",");
const query = `select count(*)::int approved_matches,
  coalesce(jsonb_agg(m.channel_id order by m.channel_id),'[]'::jsonb) matching_ids
  from public.slack_history_campaign_channels m
  where m.tenant_id='${tenant}'::uuid
    and m.campaign_id='${campaign}'::uuid
    and m.channel_id in(${literals})`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,
  { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
);
if (!response.ok) throw Error(`LIVE roster comparison HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  !Number.isInteger(rows[0]?.approved_matches) ||
  !Array.isArray(rows[0]?.matching_ids))
  throw Error("LIVE roster comparison shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(),
  visibleCurrentPublicChannelsChecked: visible.length,
  ...rows[0], messageContentReturned: false, productionDataWrites: false }));
