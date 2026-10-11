/** Read-only stored-email discovery. Claimed sender domains are NOT sender authentication. */
import { writeFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";
const project = "tgbnakbxwcqjeimygroz",
  tenant = "00000000-0000-0000-0000-000000000001";
if (process.argv.slice(2).join(" ") !== "--read-only-production")
  throw Error("Explicit production read-only scope required");
const token = savedCliToken();
async function read(path, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error(`Read unavailable HTTP ${r.status}; response withheld`);
  const chunks = [];
  let size = 0;
  for await (const c of r.body) {
    size += c.byteLength;
    if (size > 1048576) throw Error("Response exceeds bound");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const meta = await read("");
if (
  meta.id !== project ||
  meta.organization_id !== "nmhqcjrjrtwsvlcvqqnh" ||
  meta.status !== "ACTIVE_HEALTHY"
)
  throw Error("Production identity differs");
const rows = await read(
  "/database/query/read-only",
  `with source as materialized (
 select id,direction,raw_payload->'has_attachments'='true'::jsonb as attachment_hint,
 coalesce(subject ~* 'voice[ -]?mail',false) as subject_candidate,
 case when lower(trim(split_part(from_email,'@',2))) ~ '(^|\\.)(birchills\\.net|sipcentric\\.com|simwood\\.com|nimvelo\\.com)$'
 then substring(lower(trim(split_part(from_email,'@',2))) from '(birchills\\.net|sipcentric\\.com|simwood\\.com|nimvelo\\.com)$') end as provider_domain
 from public.email_messages where tenant_id='${tenant}'
), attachments as materialized (
 select a.message_id,count(*) as metadata_count,
 count(*) filter(where lower(coalesce(a.mime_type,'')) like 'audio/%' or lower(coalesce(a.filename,'')) ~ '\\.(wav|wave|mp3|ogg|oga|m4a|aac|flac|gsm|amr|wma)$') as audio_candidates,
 count(*) filter(where a.storage_path is not null and a.size_bytes>0 and (lower(coalesce(a.mime_type,'')) like 'audio/%' or lower(coalesce(a.filename,'')) ~ '\\.(wav|wave|mp3|ogg|oga|m4a|aac|flac|gsm|amr|wma)$')) as audio_pointers
 from public.email_attachments a join source s on s.id=a.message_id where a.tenant_id='${tenant}' group by a.message_id
), matched as (
 select s.*,coalesce(a.metadata_count,0) as attachment_metadata,coalesce(a.audio_candidates,0) as audio_candidates,coalesce(a.audio_pointers,0) as audio_pointers
 from source s left join attachments a on a.message_id=s.id where s.provider_domain is not null or s.subject_candidate or coalesce(a.audio_candidates,0)>0
)
select jsonb_build_object('observedAt',clock_timestamp(),'tenantExists',exists(select 1 from public.tenants where id='${tenant}'),
 'storedEmails',(select count(*) from source),'storedVoicemails',(select count(*) from public.receptionist_voicemails where tenant_id='${tenant}'),
 'subjectCandidates',(select count(*) from source where subject_candidate),
 'providerDomainCandidates',(select count(*) from source where provider_domain is not null),
 'audioMetadataMessageCandidates',(select count(*) from attachments where audio_candidates>0),
 'audioPointerMessageCandidates',(select count(*) from attachments where audio_pointers>0),
 'matchedCount',(select count(*) from matched),
 'domains',(select coalesce(jsonb_agg(x order by provider_domain),'[]') from (select provider_domain,count(*) as messages,count(*) filter(where subject_candidate) as subject_candidates,count(*) filter(where attachment_hint) as attachment_hints,count(*) filter(where audio_candidates>0) as audio_metadata_messages from matched where provider_domain is not null group by provider_domain)x),
 'privateCandidates',(select coalesce(jsonb_agg(x),'[]') from (select id,direction,provider_domain,subject_candidate,attachment_hint,attachment_metadata,audio_candidates,audio_pointers from matched order by audio_candidates desc,id limit 50)x)) as evidence`,
);
if (rows.length !== 1 || rows[0]?.evidence?.tenantExists !== true)
  throw Error("Company read unverified");
const { privateCandidates, ...counts } = rows[0].evidence;
if (!Array.isArray(privateCandidates) || privateCandidates.length > 50)
  throw Error("Bounded candidates missing");
const report = {
  version: "learn-voicemail-provider-email-audit/1",
  projectRef: project,
  tenantId: tenant,
  ...counts,
  privateSampleSize: privateCandidates.length,
  providerRequests: 0,
  productionChanged: false,
  state: "stored_candidate_query_complete",
  limitations: [
    "One statement snapshot of stored records only; no provider mailbox inventory.",
    "Sender domains and subject/attachment clues do not establish authentic voicemail, ownership, playable audio or delivery.",
    "Sender addresses, subjects, bodies, filenames, storage pointers and credentials are not returned.",
    "Private candidate IDs are limited to 50; no email or audio content was downloaded.",
  ],
};
writeFileSync(
  ".verification-results/voicemail-provider-email-audit-private.json",
  JSON.stringify({ report, privateCandidates }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
writeFileSync(
  ".verification-results/voicemail-provider-email-audit-result.json",
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
