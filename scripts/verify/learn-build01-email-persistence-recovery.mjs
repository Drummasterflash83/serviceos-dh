/** Exact six-checkpoint LIVE recovery. Rehearse with rollback before applying. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { savedCliToken } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-live", "--apply-live"].includes(mode))
  throw Error("Explicit LIVE rehearsal or apply mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "ec84daae-b135-4547-a1de-794bfcd3fbf2";
const directory = ".verification-results/learn-build01-email-persistence-recovery-20261016";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const timestamp = /^2026-10-16T\d\d:\d\d:\d\d\.\d{1,6}\+00:00$/;
const token = savedCliToken();
if (typeof token !== "string" || token.length < 20)
  throw Error("Existing saved management login required");
await mkdir(directory, { recursive: true, mode: 0o700 });

async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }) },
  );
  const body = await response.json().catch(() => null);
  if (!readOnly && (!response.ok || !Array.isArray(body)))
    await writeFile(`${directory}/${batch}.http-error.json`,
      JSON.stringify({ httpStatus: response.status, body }) + "\n",
      { flag: "wx", mode: 0o600 });
  if (!response.ok || !Array.isArray(body))
    throw Error(`Recovery ${readOnly ? "preflight" : "transaction"} unconfirmed (HTTP ${response.status})`);
  return { status: response.status, rows: body };
}

const preflight = `select c.email_account_id::text account_id,c.generation::text generation,
 c.revision::text revision,to_char(c.updated_at at time zone 'UTC',
 'YYYY-MM-DD"T"HH24:MI:SS.US+00:00') blocked_at,
 c.continuation->>'fetch_policy' fetch_policy,
 (select count(*)::int from public.google_workspace_mailboxes m
   join public.email_accounts e on e.tenant_id=m.tenant_id
     and lower(e.email_address)=lower(m.email_address)
   join public.google_workspace_connections g on g.tenant_id=m.tenant_id
     and g.id=m.connection_id
   where e.tenant_id=c.tenant_id and e.id=c.email_account_id
     and e.provider='gmail' and e.status='active_dwd'
     and m.status in ('pending','active') and m.sync_enabled
     and m.directory_identity_conflict is not true and g.status='active'
     and lower(g.domain)=split_part(lower(e.email_address),'@',2)
     and g.last_verified_at is not null
     and g.last_verified_at<=now()+interval '5 seconds'
     and nullif(g.service_account_email,'') is not null) authority_matches,
 exists(select 1 from public.email_sync_runs r
   where r.tenant_id=c.tenant_id and r.provider='gmail'
     and r.metadata->>'email_account_id'=c.email_account_id::text
     and r.status='failed' and r.error_message='persistence_failed'
     and r.completed_at=c.updated_at
     and r.metadata#>>'{email_ingestion_v2,evidence,classification}'='persistence_failure'
     and r.metadata#>>'{email_ingestion_v2,evidence,persistence}'='unknown') failure_matches
 from public.email_ingestion_checkpoints c
 where c.tenant_id='${tenant}'::uuid and c.stream='recent'
   and c.state='blocked' and c.block_code='persistence_failed'
   and c.owner_attempt_id is null order by c.email_account_id`;

function checkTargets(rows) {
  if (rows.length !== 6 || rows.some((row) =>
    !uuid.test(row.account_id) || !uuid.test(row.generation) ||
    !/^(0|[1-9][0-9]*)$/.test(row.revision) ||
    !timestamp.test(row.blocked_at) || row.fetch_policy !== "refetch_all" ||
    row.authority_matches !== 1 || row.failure_matches !== true))
    throw Error("The exact six LIVE checkpoint or source-authority guards did not pass");
  return rows.map(({ account_id, generation, revision, blocked_at }) =>
    ({ account_id, generation, revision, blocked_at }));
}
const digest = (targets) => createHash("sha256").update(JSON.stringify(targets)).digest("hex");
let targets;
if (mode === "--rehearse-live") {
  targets = checkTargets((await query(preflight, true)).rows);
} else {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".rehearsal.json"));
  const receipts = await Promise.all(names.map(async (name) =>
    JSON.parse(await readFile(`${directory}/${name}`, "utf8"))));
  const matching = receipts.filter((item) => item.state === "rehearsed_rolled_back" &&
    Date.now() - Date.parse(item.observedAt) >= 0 &&
    Date.now() - Date.parse(item.observedAt) < 30 * 60 * 1000 &&
    Array.isArray(item.targets) && item.digest === digest(item.targets));
  if (!matching.length) throw Error("Fresh exact rolled-back rehearsal required");
  matching.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  targets = checkTargets(matching[0].targets.map((target) => ({
    ...target, fetch_policy: "refetch_all", authority_matches: 1, failure_matches: true,
  })));
  const current = checkTargets((await query(preflight, true)).rows);
  if (digest(current) !== digest(targets))
    throw Error("LIVE checkpoints changed since the rehearsal");
}

const batch = randomUUID();
const path = `${directory}/${batch}`;
const prepared = { state: "prepared_not_submitted", mode, batch,
  observedAt: new Date().toISOString(), digest: digest(targets), targets };
const handle = await open(`${path}.journal.json`, "wx", 0o600);
await handle.writeFile(JSON.stringify(prepared) + "\n");
await handle.sync();
await handle.close();

const targetSql = targets.map((target) =>
  `('${target.account_id}'::uuid,'${target.generation}'::uuid,${target.revision}::bigint,` +
  `'${target.blocked_at}'::timestamptz)`).join(",\n");
const sql = `begin;
set local lock_timeout='3s';
set local statement_timeout='40s';
create temp table expected_email_recovery(account_id uuid primary key,generation uuid,
 revision bigint,blocked_at timestamptz) on commit drop;
insert into expected_email_recovery values ${targetSql};
do $recovery$
declare
 t uuid:='${tenant}'::uuid; actor uuid:='${actor}'::uuid;
 target record; c public.email_ingestion_checkpoints%rowtype;
 attempt uuid; claim_id uuid; release_id uuid; result jsonb;
 claim_revision bigint; before_continuation jsonb;
begin
 if (select count(*) from expected_email_recovery)<>6 or
   (select count(*) from public.email_ingestion_checkpoints
     where tenant_id=t and stream='recent' and state='blocked'
       and block_code='persistence_failed')<>6
 then raise exception 'exact_hold_roster_changed'; end if;
 -- Lock the complete reviewed set in stable order before making any change.
 perform 1 from public.email_ingestion_checkpoints cp
   join expected_email_recovery e on e.account_id=cp.email_account_id
   where cp.tenant_id=t and cp.stream='recent'
   order by cp.email_account_id for update of cp;
 if (select count(*) from public.email_ingestion_checkpoints cp
   join expected_email_recovery e on e.account_id=cp.email_account_id
   where cp.tenant_id=t and cp.stream='recent'
     and cp.generation=e.generation and cp.revision=e.revision
     and cp.updated_at=e.blocked_at and cp.state='blocked'
     and cp.block_code='persistence_failed' and cp.owner_attempt_id is null
     and cp.continuation->>'fetch_policy'='refetch_all')<>6
 then raise exception 'exact_checkpoint_changed'; end if;
 if not exists(select 1 from public.learn_operator_input_requests r
   join public.platform_authority_grants g on g.profile_id=r.actor_id
   where r.tenant_id=t and r.actor_id=actor
     and r.created_at>now()-interval '7 days'
     and g.permission='platform.controlplane.admin'
     and coalesce(g.effective_from,'-infinity')<=now()
     and coalesce(g.effective_to,'infinity')>now())
 then raise exception 'operator_authority_unconfirmed'; end if;
 for target in select * from expected_email_recovery order by account_id loop
   select * into strict c from public.email_ingestion_checkpoints
     where tenant_id=t and email_account_id=target.account_id and stream='recent';
   before_continuation:=c.continuation;
   if (select count(*) from public.google_workspace_mailboxes m
     join public.email_accounts a on a.tenant_id=m.tenant_id
       and lower(a.email_address)=lower(m.email_address)
     join public.google_workspace_connections g on g.tenant_id=m.tenant_id
       and g.id=m.connection_id
     where a.tenant_id=t and a.id=target.account_id
       and a.provider='gmail' and a.status='active_dwd'
       and m.status in('pending','active') and m.sync_enabled
       and m.directory_identity_conflict is not true and g.status='active'
       and lower(g.domain)=split_part(lower(a.email_address),'@',2)
       and g.last_verified_at is not null
       and g.last_verified_at<=now()+interval '5 seconds'
       and nullif(g.service_account_email,'') is not null)<>1
   then raise exception 'mailbox_authority_changed'; end if;
   if not exists(select 1 from public.email_sync_runs r
     where r.tenant_id=t and r.provider='gmail' and r.status='failed'
       and r.metadata->>'email_account_id'=target.account_id::text
       and r.error_message='persistence_failed' and r.completed_at=target.blocked_at
       and r.metadata#>>'{email_ingestion_v2,evidence,classification}'='persistence_failure'
       and r.metadata#>>'{email_ingestion_v2,evidence,persistence}'='unknown')
   then raise exception 'prior_failure_changed'; end if;
   -- Legacy October 2 running rows have no checkpoint ownership. Only an
   -- actual recent attempt or running leased job can race this recovery.
   if exists(select 1 from public.email_sync_runs r where r.tenant_id=t
     and r.provider='gmail' and r.sync_type='workspace_messages'
     and r.started_at>now()-interval '1 hour'
     and r.status='running' and r.metadata->>'email_account_id'=target.account_id::text)
     or exists(select 1 from public.platform_jobs j where j.tenant_id=t
       and j.job_type='email.workspace_sync' and j.status='running'
       and j.payload->>'email_account_id'=target.account_id::text)
   then raise exception 'concurrent_attempt_present'; end if;
   attempt:=gen_random_uuid(); claim_id:=gen_random_uuid(); release_id:=gen_random_uuid();
   insert into public.email_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
     values(attempt,t,'gmail','workspace_messages','running',
       jsonb_build_object('email_account_id',target.account_id,
         'operator_recovery','learn-build01-persistence-20261016',
         'recovery_batch','${batch}'));
   result:=public.email_ingestion_transition_v2(t,target.account_id,'recent',
     attempt,claim_id,'claim',target.generation,target.revision,null,
     jsonb_build_object('recovery',jsonb_build_object('actor_user_id',actor,
       'authorization_reference','learn-build01-persistence-20261016',
       'reason_code','operator_resume')));
   if result->>'disposition'<>'applied' or
     result#>>'{accepted_result,checkpoint_state}'<>'claimed' or
     result#>>'{accepted_result,owner_attempt_id}'<>attempt::text
   then raise exception 'claim_not_verified'; end if;
   claim_revision:=(result#>>'{accepted_result,revision}')::bigint;
   result:=public.email_ingestion_transition_v2(t,target.account_id,'recent',
     attempt,release_id,'release',target.generation,claim_revision,attempt,
     jsonb_build_object('reason_code','requested_yield',
       'attempt_evidence',jsonb_build_object('persistence','confirmed',
         'message_upsert_count',0,'thread_upsert_count',0,'ids_seen',0,
         'gone_count',0,'unresolved_count',0,'coverage_complete',false)));
   if result->>'disposition'<>'applied' or
     result#>>'{accepted_result,checkpoint_state}'<>'ready' or
     result#>>'{accepted_result,owner_attempt_id}' is not null or
     result#>>'{accepted_result,revision}'<>(claim_revision+1)::text
   then raise exception 'release_not_verified'; end if;
   select * into strict c from public.email_ingestion_checkpoints
     where tenant_id=t and email_account_id=target.account_id and stream='recent';
   if c.state<>'ready' or c.owner_attempt_id is not null or c.block_code is not null
     or c.continuation is distinct from before_continuation or
     not exists(select 1 from public.email_sync_runs r where r.id=attempt
       and r.tenant_id=t and r.status='success' and r.records_processed=0) or
     (select count(*) from public.email_ingestion_transitions x
       where x.tenant_id=t and x.attempt_id=attempt
         and x.transition_id in(claim_id,release_id))<>2
   then raise exception 'post_recovery_verification_failed'; end if;
 end loop;
end $recovery$;
select 'six_checkpoints_ready' marker,
  (select count(*)::int from public.email_ingestion_checkpoints c
   join expected_email_recovery e on e.account_id=c.email_account_id
   where c.tenant_id='${tenant}'::uuid and c.stream='recent'
     and c.state='ready' and c.owner_attempt_id is null and c.block_code is null) ready;
${mode === "--rehearse-live" ? "rollback" : "commit"};`;

let response;
try {
  response = await query(sql, false);
} catch {
  await writeFile(`${path}.result.json`, JSON.stringify({ state: "submission_uncertain",
    batch, digest: digest(targets), observedAt: new Date().toISOString() }) + "\n",
    { flag: "wx", mode: 0o600 });
  throw Error("Recovery submission uncertain; inspect the exact batch before retrying");
}
const marker = response.rows.find((row) => row.marker === "six_checkpoints_ready");
const state = response.status === 201 && marker?.ready === 6
  ? mode === "--rehearse-live" ? "rehearsed_rolled_back" : "applied_pending_readback"
  : "requires_inspection";
const result = { state, batch, digest: digest(targets), observedAt: new Date().toISOString(),
  targetCount: targets.length, marker: marker?.marker ?? null,
  ...(mode === "--rehearse-live" ? { targets } : {}) };
await writeFile(`${path}.${mode === "--rehearse-live" ? "rehearsal" : "result"}.json`,
  JSON.stringify(result) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ state, batch, digest: result.digest,
  targetCount: targets.length, marker: result.marker }));
if (state === "requires_inspection") process.exitCode = 1;
