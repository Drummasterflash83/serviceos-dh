/** Read-only production aggregates for the reviewed draft-reconciliation scope.
 * No customer text, identifiers, credentials, or source rows leave the database.
 */
import { writeFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";
const project = "tgbnakbxwcqjeimygroz",
  tenant = "00000000-0000-0000-0000-000000000001";
if (!["--read-only-production", "--explain-production"].includes(process.argv.slice(2).join(" ")))
  throw Error("Explicit read-only scope required");
const token = savedCliToken();
async function get(path, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const detail = await r.text();
    writeFileSync(".verification-results/email-draft-impact-error.txt", detail, { mode: 0o600 });
    throw Error("Production aggregate read failed HTTP " + r.status + "; response withheld");
  }
  const body = await r.text();
  if (body.length > 131072) throw Error("Aggregate response too large");
  return JSON.parse(body);
}
const p = await get("");
if (
  p.id !== project ||
  p.organization_id !== "nmhqcjrjrtwsvlcvqqnh" ||
  p.status !== "ACTIVE_HEALTHY"
)
  throw Error("Production identity differs");
const meta = await get(
  "/database/query/read-only",
  `select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('measurements','learn_assessments','recommendations','interaction_match_suggestions') order by 1`,
);
const present = new Set(meta.map((r) => r.name));
const optional = [...present]
  .map((name) =>
    ["recommendations", "interaction_match_suggestions"].includes(name)
      ? `'${name}',(select jsonb_build_object('tenantRows',count(*),'rowsLinkedToDraftInteraction',count(*) filter(where x.interaction_id in(select id from drafts))) from public.${name} x where x.tenant_id='${tenant}')`
      : `'${name}',(select jsonb_build_object('tenantRows',count(*),'rowsMentioningDraftInteraction',count(*) filter(where to_jsonb(x)::text ~ (select string_agg(id::text,'|') from drafts)),'rowsMentioningDraftSource',count(*) filter(where to_jsonb(x)::text ~ (select string_agg(source_id::text,'|') from drafts))) from public.${name} x where x.tenant_id='${tenant}')`,
  )
  .join(",");
const query = `set local statement_timeout='20s';with drafts as materialized (
 select i.* from public.interactions i join public.email_messages m on m.tenant_id=i.tenant_id and m.id=i.source_id and i.source_table='email_messages'
 where m.tenant_id='${tenant}' and m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb
), eligible_people as materialized (select i.related_person_id,count(*) as n from public.interactions i where i.tenant_id='${tenant}' and i.related_person_id is not null and i.id not in(select id from drafts) group by 1), affected as materialized (
 select c.* from public.customer_cards c where c.tenant_id='${tenant}' and exists(select 1 from drafts d where d.related_person_id=c.person_id or d.related_company_id=c.company_id or d.metadata->'identity_delivery'->>'cardId'=c.id::text)
)
select jsonb_build_object('observedAt',clock_timestamp(),
 'draftMessages',(select count(*) from public.email_messages m where m.tenant_id='${tenant}' and m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb),
 'draftInteractions',(select count(*) from drafts),'draftsLinkedToPerson',(select count(*) from drafts where related_person_id is not null),
 'draftProcessingStates',(select coalesce(jsonb_agg(x),'[]') from (select processing_status,count(*) as count from drafts group by 1 order by 1)x),
 'affectedCards',(select count(*) from affected),
 'cardsWithDraftSummaryMatch',(select count(*) from affected c where exists(select 1 from drafts d where (d.related_person_id=c.person_id or d.related_company_id=c.company_id) and c.summary is not null and c.summary=coalesce(d.summary,d.body_preview))),
 'cardsWithDraftLatestTimestamp',(select count(*) from affected c where exists(select 1 from drafts d where (d.related_person_id=c.person_id or d.related_company_id=c.company_id) and c.latest_activity_at=d.occurred_at)),
 'cardsWithDraftPrioritySource',(select count(*) from affected c where exists(select 1 from drafts d where to_jsonb(c)->'priority_inputs'->>'sourceInteractionId'=d.id::text)),
 'cardsWithNoOtherPersonCommunications',(select count(*) from affected c where c.person_id is not null and not exists(select 1 from eligible_people ep where ep.related_person_id=c.person_id)),
 'cardsWithLockedFields',(select count(*) from affected c where coalesce(to_jsonb(c)->'locked_fields','[]')<>'[]'::jsonb),
 'priorityVersions',(select coalesce(jsonb_agg(x),'[]') from (select coalesce(to_jsonb(c)->'priority_inputs'->>'version','legacy/unversioned') as version,count(*) as count from affected c group by 1 order by 1)x),
 'dependentTables',jsonb_build_object(${optional})
) as result`;
if (process.argv[2] === "--explain-production") {
  const plan = await get(
    "/database/query/read-only",
    query.replace("set local statement_timeout='20s';", "explain (format json) "),
  );
  writeFileSync(
    ".verification-results/email-draft-impact-plan.json",
    JSON.stringify(plan, null, 2) + "\n",
  );
  console.log("Read-only query plan saved; query not executed");
  process.exit(0);
}
const rows = await get("/database/query/read-only", query);
if (rows.length !== 1 || !rows[0].result) throw Error("Incomplete aggregate result");
const report = {
  version: "learn-email-draft-impact/1",
  projectRef: project,
  ...rows[0].result,
  productionChanged: false,
  providerRequests: 0,
  limitations: [
    "Card association includes person/company matches and can overstate affected fields.",
    "Exact summary/timestamp matches are candidates, not proof of automated authorship.",
    "Recommendation/suggestion counts use direct interaction links; measurement counts scan retained JSON for UUID references. Missing references do not prove no historical influence.",
    "No personal identifiers, bodies, addresses, card text or score values are returned.",
  ],
};
writeFileSync(
  "docs/operations/evidence/learn-email-draft-impact-2026-10-11.json",
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(report, null, 2));
