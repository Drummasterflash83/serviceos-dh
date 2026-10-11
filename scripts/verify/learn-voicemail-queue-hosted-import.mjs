/** Generated voicemail through real TEST queue RPCs/Storage. No login access or
 * real-provider transport. Exact fixture only; exclusive journal prevents reruns. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readVoicemailQueueCatalog,
  VOICEMAIL_QUEUE_CATALOG,
  voicemailQueueSnapshot,
} from "./learn-voicemail-queue-catalog.mjs";
import { runVoicemailQueueJob } from "../../supabase/functions/_shared/voicemail/queue.ts";
import { importPrivateVoicemail } from "./voicemail-auth/private-import.mjs";
import { decodeVoicemailAudio } from "./voicemail-auth/decode-audio.mjs";
const schemaHash = "ae32949d7a76097a899e92d36654293e";
const id = (n) => "ce740001-aaaa-4000-8000-" + String(n).padStart(12, "0");
const ids = { tenant: id(1), mailbox: id(2), account: id(3), route: id(4), job: id(5) };
const actor = "effb2fb2-0782-491b-9a49-5cf2a5ef9e4d"; // Existing banned synthetic playback actor; no new entitlement.
const tag = "voicemail-queue-acceptance-ce740001",
  worker = "synthetic-" + tag;
const stem = ".verification-results/voicemail-queue-hosted-import";
const mode = process.argv[2];
if (
  !["--prepare", "--rehearse", "--run", "--inspect"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit synthetic TEST import required");
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const check = (v, m) => {
  if (!v) throw Error(m);
};
const uuid = (v) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const save = (suffix, data) => {
  const fd = openSync(stem + suffix, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(data, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const schema = await readVoicemailQueueCatalog(token);
check(schema.fingerprint === schemaHash, "Exact TEST 074 required");
const payload = {
  routeId: ids.route,
  accountId: ids.account,
  messageId: "ce740001",
  internalDate: "1791705600000",
};
const inspection = `select jsonb_build_object(
 'tenant',(select jsonb_build_object('id',id,'status',status,'fixture',metadata->>'learn_voicemail_run'='${tag}') from tenants where id='${ids.tenant}'),
 'route',(select jsonb_build_object('id',id,'enabled',enabled,'owner',owner_user_id,'accessMode',access_mode,'actor',verified_by) from receptionist_voicemail_email_routes where id='${ids.route}'),
 'account',(select jsonb_build_object('id',id,'status',status) from email_accounts where id='${ids.account}'),
 'job',(select jsonb_build_object('id',id,'tenant',tenant_id,'status',status,'attempt',attempt_count,'worker',claimed_by,'lease',lease_expires_at,'records',records_processed,'error',error_code) from platform_jobs where id='${ids.job}'),
 'bindings',(select coalesce(jsonb_agg(jsonb_build_object('intake',intake_id,'source',source_id,'job',job_id)),'[]') from receptionist_voicemail_jobs where tenant_id='${ids.tenant}'),
 'receipts',(select coalesce(jsonb_agg(receipt),'[]') from receptionist_voicemail_job_receipts where tenant_id='${ids.tenant}'),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'owner',owner_user_id,'mailbox',mailbox_id,'emailStatus',email_status,'audio',recording_available)),'[]') from receptionist_voicemails where tenant_id='${ids.tenant}'),
 'objects',(select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name,'bytes',metadata->>'size') order by bucket_id,name),'[]') from storage.objects where name like '${ids.tenant}/%'),
 'mailboxManagers',(select count(*)::int from receptionist_mailbox_managers where tenant_id='${ids.tenant}'),
 'profiles',(select count(*)::int from profiles where tenant_id='${ids.tenant}'),
 'actorStillBanned',(select banned_until>clock_timestamp() from auth.users where id='${actor}' and email='learn-playback-73e083fe@example.invalid')
) as observation`;
const observe = async () => (await query(inspection))[0].observation;
if (mode === "--inspect") {
  const observed = await observe();
  console.log(
    JSON.stringify(
      {
        state: "read_only_inspection",
        observedAt: new Date().toISOString(),
        projectRef: TEST_PROJECT,
        observed,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const baseline = voicemailQueueSnapshot(schema.catalog.phone);
const before = await query(baseline);
check(before.length === 136, "Full preservation baseline required");
const preflight = (
  await query(`select
 (select count(*)::int from tenants where id='${ids.tenant}' or slug='${tag}') as tenants,
 (select count(*)::int from email_accounts where id='${ids.account}') as accounts,
 (select count(*)::int from receptionist_mailboxes where id='${ids.mailbox}') as mailboxes,
 (select count(*)::int from receptionist_voicemail_email_routes) as routes,
 (select count(*)::int from platform_jobs where job_type='phone.voicemail_import') as jobs,
 (select count(*)::int from storage.objects where name like '${ids.tenant}/%') as objects,
 (select banned_until>clock_timestamp() and email='learn-playback-73e083fe@example.invalid' from auth.users where id='${actor}') as retired_actor,
 to_regclass('cron.job') is not null as cron_exists`)
)[0];
check(
  ["tenants", "accounts", "mailboxes", "routes", "jobs", "objects"].every(
    (k) => preflight[k] === 0,
  ) && preflight.retired_actor === true,
  "Unused isolated fixture and banned synthetic actor required",
);
if (preflight.cron_exists) {
  const cron = await query("select count(*)::int as count from cron.job where active");
  check(
    cron[0].count === 0,
    "No active TEST database cron jobs allowed during synthetic capture fixture",
  );
}
const setup = `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table platform_jobs in share row exclusive mode;
do $$begin
 if md5((${VOICEMAIL_QUEUE_CATALOG})::text)<>'${schemaHash}' or exists(select 1 from tenants where id='${ids.tenant}' or slug='${tag}')
 or exists(select 1 from platform_jobs where job_type='phone.voicemail_import') or exists(select 1 from receptionist_voicemail_email_routes)
 or not exists(select 1 from auth.users where id='${actor}' and email='learn-playback-73e083fe@example.invalid' and banned_until>clock_timestamp())
 then raise exception 'Synthetic fixture prerequisites changed';end if;
end$$;
insert into tenants(id,slug,display_name,status,metadata) values('${ids.tenant}','${tag}','Synthetic voicemail acceptance — no client access','active','{"synthetic":true,"learn_voicemail_run":"${tag}"}');
insert into email_accounts(id,tenant_id,provider,email_address,display_name,status) values('${ids.account}','${ids.tenant}','gmail','synthetic@example.invalid','Synthetic source identity — no credentials','active_dwd');
insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension) values('${ids.mailbox}','${ids.tenant}','synthetic-ce740001','Synthetic voicemail acceptance','601');
insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,access_mode,received_from,received_until,binding_evidence,verified_by,enabled)
values('${ids.route}','${ids.tenant}','${ids.mailbox}','${ids.account}','synthetic@example.invalid','birchills-net.20251104.gappssmtp.com','managers_only','2026-10-01','2026-10-12','Synthetic runner verification only. verified_by is the previously retired synthetic actor; no human verification, mailbox ownership, manager grant or real provider connection is implied.','${actor}',true);
insert into platform_jobs(id,tenant_id,job_type,job_key,status,max_attempts,payload,metadata) values('${ids.job}','${ids.tenant}','phone.voicemail_import','${tag}','queued',3,${q(JSON.stringify(payload))},'{"synthetic":true,"learn_voicemail_run":"${tag}"}');
set local role service_role;
do $$declare claimed public.platform_jobs%rowtype;n integer:=0;begin
 for claimed in select * from public.platform_jobs_claim('${worker}',1,300,array['phone.voicemail_import']) loop
  if claimed.id<>'${ids.job}' or claimed.tenant_id<>'${ids.tenant}' or claimed.attempt_count<>1 then raise exception 'Synthetic claim differs';end if;n:=n+1;
 end loop;
 if n<>1 then raise exception 'Synthetic claim missing';end if;
end$$;
reset role;select 'synthetic_fixture_created_and_claimed' as marker;commit;`;
const retire = `begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $$begin
 if exists(select 1 from public.tenants where id='${ids.tenant}') and not exists(select 1 from public.tenants where id='${ids.tenant}' and metadata->>'learn_voicemail_run'='${tag}' and metadata->>'synthetic'='true') then raise exception 'Fixture ownership mismatch';end if;
end$$;
update public.receptionist_voicemail_email_routes set enabled=false where tenant_id='${ids.tenant}' and id='${ids.route}' and enabled;
update public.email_accounts set status='disabled' where tenant_id='${ids.tenant}' and id='${ids.account}' and status<>'disabled';
update public.tenants set status='archived' where id='${ids.tenant}' and status<>'archived';
update public.platform_jobs set status='cancelled',cancelled_at=clock_timestamp(),lease_expires_at=null,error_code='synthetic_acceptance_finished',last_error='Synthetic acceptance ended; retained evidence needs inspection.' where id='${ids.job}' and tenant_id='${ids.tenant}' and status in('queued','running','retrying');
select 'synthetic_fixture_retired' as marker;commit;`;
const definition = {
  projectRef: TEST_PROJECT,
  schemaFingerprint: schemaHash,
  ids,
  tag,
  actor,
  worker,
  payload,
  setupSha256: hash(setup),
  retireSha256: hash(retire),
  usersCreated: 0,
  grantsCreated: 0,
  realProviderRequests: 0,
  generatedAudioSeconds: 28,
};
if (mode === "--prepare") {
  save("-plan.json", { ...definition, preparedAt: new Date().toISOString() });
  writeFileSync(stem + "-setup.sql", setup, { flag: "wx", mode: 0o600 });
  writeFileSync(stem + "-retire.sql", retire, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ state: "prepared", ...definition }, null, 2));
  process.exit(0);
}
const plan = JSON.parse(readFileSync(stem + "-plan.json"));
check(
  Object.keys(definition).every((k) => JSON.stringify(plan[k]) === JSON.stringify(definition[k])) &&
    Date.now() - Date.parse(plan.preparedAt) < 3600000,
  "Fresh exact plan required",
);
if (mode === "--rehearse") {
  save("-rehearse-journal.json", { ...definition, startedAt: new Date().toISOString(), before });
  let response = null;
  try {
    response = await query(setup.replace(/commit;$/, "rollback;"), false);
  } catch (e) {
    save("-rehearse-response-unconfirmed.json", { message: e.message });
  }
  const after = await query(baseline),
    observed = await observe(),
    afterSchema = await readVoicemailQueueCatalog(token);
  const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
  const ok =
    response?.some((r) => r.marker === "synthetic_fixture_created_and_claimed") &&
    stable(before) === stable(after) &&
    afterSchema.fingerprint === schemaHash &&
    observed.tenant === null &&
    observed.route === null &&
    observed.account === null &&
    observed.job === null;
  const report = {
    state: ok ? "synthetic_setup_rehearsed_rolled_back" : "requires_inspection",
    observedAt: new Date().toISOString(),
    setupSha256: hash(setup),
    schemaFingerprint: schemaHash,
    preservedDatasets: stable(before) === stable(after) ? 136 : null,
    usersCreated: 0,
    accessGrantsCreated: 0,
    realProviderRequests: 0,
    productionChanged: false,
  };
  save("-rehearse-result.json", report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}
const rehearsal = JSON.parse(readFileSync(stem + "-rehearse-result.json"));
check(
  rehearsal.state === "synthetic_setup_rehearsed_rolled_back" &&
    rehearsal.setupSha256 === hash(setup) &&
    rehearsal.schemaFingerprint === schemaHash &&
    Date.now() - Date.parse(rehearsal.observedAt) < 1800000,
  "Fresh exact synthetic setup rehearsal required",
);
const fixture = JSON.parse(
  execFileSync(process.execPath, ["scripts/verify/voicemail-auth/edge-fixture.mjs"], {
    encoding: "utf8",
    maxBuffer: 2000000,
  }),
);
const raw = Buffer.from(fixture.raw);
check(raw.length < 1048576 && fixture.audioBytes < 1048576, "Bounded synthetic source required");
save("-journal.json", {
  ...definition,
  startedAt: new Date().toISOString(),
  before,
  rawBytes: raw.length,
  rawSha256: hash(raw),
  audioBytes: fixture.audioBytes,
  audioSha256: fixture.audioSha256,
});
// Existing TEST keys stay in memory and are sent only to this same TEST project.
const keysResponse = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
check(keysResponse.ok, "TEST credentials unavailable");
const keys = await keysResponse.json();
function key(name) {
  const found = keys.filter((k) => k.name === name);
  check(found.length === 1, "Unique TEST key required");
  const v = found[0].api_key,
    c = JSON.parse(Buffer.from(v.split(".")[1], "base64url"));
  check(c.ref === TEST_PROJECT && c.role === name, "Credential target differs");
  return v;
}
const origin = `https://${TEST_PROJECT}.supabase.co`,
  options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) => {
        check(String(url).startsWith(origin + "/"), "Unexpected SDK destination");
        return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30000) });
      },
    },
  };
const admin = createClient(origin, key("service_role"), options),
  anon = createClient(origin, key("anon"), options);
let prepared = null,
  sourceLoads = 0,
  uploadCalls = 0,
  downloadCalls = 0,
  publicationAcknowledgementDropped = false,
  queueOutcome = null,
  replay = null,
  crossTenant = null,
  failure = null,
  retirementConfirmed = false;
const rpcSteps = [];
const client = new Proxy(admin, {
  get(target, k) {
    if (k === "rpc")
      return async (name, args) => {
        check(name === "voicemail_queue_step", "Unexpected fixture RPC");
        rpcSteps.push(args.p_operation);
        const r = await target.rpc(name, args);
        if (args.p_operation === "prepare" && !r.error && r.data) {
          check(
            uuid(r.data.intake_id) &&
              uuid(r.data.source_id) &&
              r.data.audio_path === `${ids.tenant}/${ids.mailbox}/${r.data.intake_id}` &&
              r.data.source_path === `${ids.tenant}/${r.data.intake_id}/${r.data.source_id}.eml`,
            "Reserved fixture paths differ",
          );
          check(!prepared, "Unexpected duplicate fixture preparation");
          prepared = r.data;
          save("-reserved.json", prepared);
        }
        if (
          args.p_operation === "publish" &&
          !r.error &&
          r.data?.state === "succeeded" &&
          !publicationAcknowledgementDropped
        ) {
          publicationAcknowledgementDropped = true;
          return { data: null, error: { message: "Synthetic lost publication acknowledgement" } };
        }
        return r;
      };
    if (k === "storage")
      return {
        from(bucket) {
          check(
            ["receptionist-voicemails", "learn-voicemail-sources"].includes(bucket),
            "Unexpected fixture bucket",
          );
          const store = target.storage.from(bucket);
          return {
            async upload(path, bytes, opts) {
              check(
                prepared &&
                  path ===
                    (bucket === "receptionist-voicemails"
                      ? prepared.audio_path
                      : prepared.source_path) &&
                  opts.upsert === false,
                "Unplanned upload",
              );
              uploadCalls++;
              return store.upload(path, bytes, opts);
            },
            async download(path) {
              check(
                prepared &&
                  path ===
                    (bucket === "receptionist-voicemails"
                      ? prepared.audio_path
                      : prepared.source_path),
                "Unplanned readback",
              );
              downloadCalls++;
              return store.download(path);
            },
          };
        },
      };
    const value = Reflect.get(target, k);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const ctx = {
  supabaseAdmin: client,
  tenantId: ids.tenant,
  jobId: ids.job,
  jobType: "phone.voicemail_import",
  payload: {},
  claim: { claimedBy: worker, attemptCount: 1 },
};
const run = (db, input) =>
  importPrivateVoicemail({
    client: db,
    tenantId: input.tenantId,
    routeId: input.routeId,
    source: { accountId: input.accountId, id: input.messageId, internalDate: input.internalDate },
    decodeAudio: decodeVoicemailAudio,
    resolver: async (name, type) => {
      check(name === fixture.dnsName && type === "TXT", "Unexpected synthetic DNS");
      return [[fixture.keyRecord]];
    },
    loadRaw: async () => {
      sourceLoads++;
      return { id: payload.messageId, internalDate: payload.internalDate, raw: Buffer.from(raw) };
    },
  });
const storageChecks = [];
try {
  save("-setup-submitted.json", { submittedAt: new Date().toISOString(), sha256: hash(setup) });
  try {
    await query(setup, false);
  } catch (e) {
    save("-setup-response-unconfirmed.json", {
      observedAt: new Date().toISOString(),
      message: e.message,
    });
  }
  const created = await observe();
  check(
    created.tenant?.fixture &&
      created.tenant.status === "active" &&
      created.route?.enabled &&
      created.route.owner === null &&
      created.route.accessMode === "managers_only" &&
      created.actorStillBanned &&
      created.profiles === 0 &&
      created.mailboxManagers === 0 &&
      created.job?.worker === worker &&
      created.job.attempt === 1 &&
      created.job.status === "running",
    "Exact fixture/claim creation unconfirmed",
  );
  save("-setup-confirmed.json", created);
  crossTenant = await runVoicemailQueueJob({ ...ctx, tenantId: id(99) }, run);
  check(crossTenant.state === "unconfirmed" && sourceLoads === 0, "Cross-tenant claim admitted");
  queueOutcome = await runVoicemailQueueJob(ctx, run);
  check(
    queueOutcome.state === "succeeded" &&
      queueOutcome.historicalReceipt === true &&
      publicationAcknowledgementDropped &&
      sourceLoads === 1 &&
      uploadCalls === 2 &&
      downloadCalls === 2,
    "Hosted queue publication or response recovery unconfirmed",
  );
  const published = await observe();
  check(
    published.job.status === "succeeded" &&
      published.job.records === 1 &&
      published.messages.length === 1 &&
      published.messages[0].id === prepared.intake_id &&
      published.messages[0].owner === null &&
      published.messages[0].emailStatus === "unknown" &&
      published.messages[0].audio &&
      published.receipts.length === 1,
    "Hosted publication identity differs",
  );
  for (const p of [
    {
      bucket: "receptionist-voicemails",
      path: prepared.audio_path,
      bytes: fixture.audioBytes,
      sha256: fixture.audioSha256,
    },
    {
      bucket: "learn-voicemail-sources",
      path: prepared.source_path,
      bytes: raw.length,
      sha256: hash(raw),
    },
  ]) {
    const read = await admin.storage.from(p.bucket).download(p.path);
    check(!read.error && read.data, "Final Storage readback unavailable");
    const bytes = new Uint8Array(await read.data.arrayBuffer());
    check(bytes.length === p.bytes && hash(bytes) === p.sha256, "Final storage digest differs");
    bytes.fill(0);
    const denied = await anon.storage.from(p.bucket).download(p.path);
    check(denied.error && !denied.data, "Anonymous private object readable");
    const publicResponse = await fetch(`${origin}/storage/v1/object/public/${p.bucket}/${p.path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    await publicResponse.body?.cancel();
    check([400, 401, 403, 404].includes(publicResponse.status), "Public object denial unconfirmed");
    storageChecks.push({
      ...p,
      hashMatches: true,
      anonymousDenied: true,
      publicStatus: publicResponse.status,
    });
  }
  const role = await query(
    `begin;set local role authenticated;set local request.jwt.claim.sub='${actor}';select public.can_manage_voicemail('${ids.tenant}','${ids.mailbox}') as allowed,(select count(*)::int from public.receptionist_voicemails where tenant_id='${ids.tenant}') as visible;rollback;`,
    false,
  );
  check(
    role.length === 1 && role[0].allowed === false && role[0].visible === 0,
    "Unentitled fixture role unexpectedly sees voicemail",
  );
  save("-private-role-denied.json", {
    allowed: false,
    visible: 0,
    scope: "SQL role only; no signed-in session or token minted",
  });
} catch (e) {
  failure = e.message;
  save("-failure-private.json", { observedAt: new Date().toISOString(), message: e.message });
} finally {
  // Retire this exact fixture even after an uncertain import; never delete evidence.
  save("-retirement-submitted.json", {
    submittedAt: new Date().toISOString(),
    sha256: hash(retire),
  });
  try {
    await query(retire, false);
  } catch (e) {
    save("-retirement-response-unconfirmed.json", {
      observedAt: new Date().toISOString(),
      message: e.message,
    });
  }
  const retired = await observe();
  retirementConfirmed =
    retired.tenant?.fixture &&
    retired.tenant.status === "archived" &&
    retired.route?.enabled === false &&
    retired.account?.status === "disabled" &&
    retired.profiles === 0 &&
    retired.mailboxManagers === 0 &&
    retired.actorStillBanned &&
    ["succeeded", "cancelled"].includes(retired.job?.status);
  save("-retired.json", retired);
  raw.fill(0);
}
if (!failure && retirementConfirmed) {
  replay = await runVoicemailQueueJob(ctx, () => {
    throw Error("Replay must not load a source");
  });
  check(
    replay.state === "succeeded" && replay.historicalReceipt && sourceLoads === 1,
    "Provider-free retired replay unconfirmed",
  );
}
// Exclude only exact newly planned/reserved rows and object paths. Everything
// else, including all Auth/role/grant rows, must retain its prior fingerprint.
const exact = {
  tenants: ["id", ids.tenant],
  email_accounts: ["id", ids.account],
  platform_jobs: ["id", ids.job],
  receptionist_mailboxes: ["id", ids.mailbox],
  receptionist_voicemail_email_routes: ["id", ids.route],
  receptionist_voicemail_jobs: ["job_id", ids.job],
  receptionist_voicemail_job_receipts: ["job_id", ids.job],
};
if (prepared) {
  exact.receptionist_voicemail_intakes = ["id", prepared.intake_id];
  exact.receptionist_voicemail_sources = ["id", prepared.source_id];
  exact.receptionist_voicemails = ["id", prepared.intake_id];
}
let afterQuery = baseline;
for (const [table, [column, value]] of Object.entries(exact)) {
  const from = `from public.${table} s`;
  check(afterQuery.split(from).length === 2, "Unambiguous fixture preservation table required");
  afterQuery = afterQuery.replace(from, from + ` where s.${column}<>'${value}'`);
}
if (prepared)
  afterQuery = afterQuery.replace(
    "from storage.objects s",
    `from storage.objects s where not ((bucket_id='receptionist-voicemails' and name='${prepared.audio_path}') or (bucket_id='learn-voicemail-sources' and name='${prepared.source_path}'))`,
  );
const after = await query(afterQuery),
  afterSchema = await readVoicemailQueueCatalog(token),
  observed = await observe();
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const preserved = stable(before) === stable(after) && afterSchema.fingerprint === schemaHash;
const exactObjects =
  prepared &&
  observed.objects.length === 2 &&
  storageChecks.length === 2 &&
  storageChecks.every((p) =>
    observed.objects.some(
      (o) => o.bucket === p.bucket && o.path === p.path && Number(o.bytes) === p.bytes,
    ),
  );
const ok =
  !failure &&
  retirementConfirmed &&
  preserved &&
  exactObjects &&
  observed.messages.length === 1 &&
  observed.bindings.length === 1 &&
  observed.receipts.length === 1;
const report = {
  state: ok ? "hosted_synthetic_queue_import_verified" : "requires_inspection",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  ids,
  queueOutcome,
  replay,
  crossTenant,
  sourceLoads,
  uploadCalls,
  downloadCalls,
  publicationAcknowledgementDropped,
  storageChecks,
  retirementConfirmed,
  preservedDatasets: preserved ? 136 : null,
  observed,
  failure,
  usersCreated: 0,
  accessGrantsCreated: 0,
  realProviderRequests: 0,
  productionChanged: false,
  limitations: [
    "Synthetic source loader and DNS key only; no Google/Birchills provider access, real route ownership, enumeration, scheduling or coverage proof.",
    "Production queue adapter/coordinator/decoder ran locally against real hosted SQL and Storage; this was not positive dispatch through the deployed platform-worker endpoint.",
    "No owner or manager entitlement created; SQL/anonymous privacy checks are not signed-in browser playback.",
    "Generated retained files are acceptance evidence, not an independent backup or restore rehearsal.",
  ],
};
save("-result.json", report);
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;
