/** Isolated synthetic TEST playback acceptance. Explicit run approval required for activation.
 * No production or real provider requests. Retain evidence; retire access separately after browser checks. */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhonePlaybackCatalog,
  PHONE_PLAYBACK_PRESERVED,
} from "./learn-phone-playback-catalog.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { phoneProcessingAuthContractMatches } from "./learn-phone-processing-auth-contract.mjs";
import { readLearnCardDetail } from "../../src/lib/learn-cards.ts";
import {
  readRetainedRecordings,
  openRetainedRecording,
} from "../../src/lib/learn-phone-playback.ts";
const path = ".verification-results/phone-playback-session.json",
  base = `https://${TEST_PROJECT}.supabase.co`,
  q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  check = (v) => {
    if (!v) throw Error("Playback acceptance requires inspection");
  };
const mode = process.argv[2];
if (process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT) throw Error("TEST target required");
const save = (p) => writeFileSync(path, JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
if (mode === "--prepare") {
  const p = {
    version: "learn-playback-session/1",
    projectRef: TEST_PROJECT,
    runId: randomUUID(),
    state: "prepared",
    user: randomUUID(),
    tenants: [randomUUID(), randomUUID()],
    company: randomUUID(),
    person: randomUUID(),
    card: randomUUID(),
    call: randomUUID(),
    recording: randomUUID(),
    foreignRecording: randomUUID(),
    interaction: randomUUID(),
    plannedChecks: [
      "Company owner card to retained recording to signed bytes",
      "Foreign company and viewer denial",
      "Private audit receipt",
      "Same-session demotion",
      "Signed-in TEST browser playback",
      "Retire owner membership and ban login",
    ],
    newOperatorGrants: 0,
    providerRequests: 0,
  };
  p.email = `learn-playback-${p.runId.slice(0, 8)}@example.invalid`;
  const fd = openSync(path, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(p, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  console.log(JSON.stringify(p, null, 2));
  process.exit(0);
}
const p = JSON.parse(readFileSync(path));
check(
  p.version === "learn-playback-session/1" &&
    p.projectRef === TEST_PROJECT &&
    p.tenants.length === 2 &&
    [
      p.runId,
      p.user,
      ...p.tenants,
      p.company,
      p.person,
      p.card,
      p.call,
      p.recording,
      p.foreignRecording,
      p.interaction,
    ].every((v) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v)) &&
    p.email === `learn-playback-${p.runId.slice(0, 8)}@example.invalid`,
);
check(["--activate", "--verify", "--retire"].includes(mode));
if (mode === "--activate")
  check(process.env.LEARN_PLAYBACK_APPROVED_RUN === p.runId && p.state === "prepared");
const token = savedCliToken();
const sql = (s, readOnly = true) => communicationQuery(token, s, { readOnly });
const request = async (route, method = "GET", body, headers = {}) => {
  const r = await fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  return { status: r.status, data, ok: r.ok };
};
const keysResponse = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  {
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
check(keysResponse.ok);
const keys = await keysResponse.json();
const key = (role) => {
  const found = keys.filter((k) => k.name === role);
  check(found.length === 1);
  const v = found[0].api_key,
    c = JSON.parse(Buffer.from(v.split(".")[1], "base64url"));
  check(c.ref === TEST_PROJECT && c.role === role);
  return v;
};
const anon = key("anon"),
  service = key("service_role"),
  admin = { apikey: service, Authorization: "Bearer " + service };
const tables = [...PHONE_PLAYBACK_PRESERVED, "public.learn_phone_playback_audit"];
const snapshot = () =>
  sql(
    tables
      .map(
        (t) =>
          `select ${q(t)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${t} s where coalesce(to_jsonb(s)->>'tenant_id','') not in (${p.tenants.map(q).join(",")}) and coalesce(to_jsonb(s)->>'id','') not in (${[p.user, ...p.tenants].map(q).join(",")}) and coalesce(to_jsonb(s)->>'user_id','')<>${q(p.user)}`,
      )
      .join(" union all "),
  );
const storage = createClient(base, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
if (mode === "--activate") {
  const catalog = await readPhonePlaybackCatalog(token);
  check(catalog.fingerprint === "a6f5cfa886fe094cc5318ecbb75b472c");
  check(phoneProcessingAuthContractMatches((await sql(AUTH_CONTRACT_QUERY))[0]?.contract));
  const bucket = await storage.storage.getBucket("phone-recordings");
  check(!bucket.error && bucket.data?.public === false);
  p.baseline = await snapshot();
  p.password = randomBytes(36).toString("base64url");
  p.state = "activation_started";
  p.startedAt = new Date().toISOString();
  save(p);
  const made = await request(
    "/auth/v1/admin/users",
    "POST",
    {
      id: p.user,
      email: p.email,
      password: p.password,
      email_confirm: true,
      app_metadata: { learn_playback_run: p.runId },
    },
    admin,
  );
  check(made.ok && made.data.id === p.user);
  p.userCreated = true;
  save(p);
  const insert = (table, row) =>
    `insert into public.${table}(${Object.keys(row).join(",")}) values(${Object.values(row)
      .map((v) =>
        v === null ? "null" : typeof v === "object" ? q(JSON.stringify(v)) + "::jsonb" : q(v),
      )
      .join(",")});`;
  let seed = "begin;set local statement_timeout='15s';";
  for (const [i, t] of p.tenants.entries())
    seed += insert("tenants", {
      id: t,
      slug: "playback-" + p.runId + "-" + i,
      display_name: "SYNTHETIC playback " + i,
      metadata: { synthetic: true, learn_playback_run: p.runId },
    });
  seed += `update public.profiles set tenant_id=${q(p.tenants[0])},role='owner' where id=${q(p.user)} and email=${q(p.email)};`;
  seed +=
    insert("companies", {
      id: p.company,
      tenant_id: p.tenants[0],
      name: "SYNTHETIC playback company",
    }) +
    insert("people", {
      id: p.person,
      tenant_id: p.tenants[0],
      company_id: p.company,
      display_name: "SYNTHETIC playback contact",
    }) +
    insert("customer_cards", {
      id: p.card,
      tenant_id: p.tenants[0],
      company_id: p.company,
      person_id: p.person,
      title: "SYNTHETIC saved call playback",
    }) +
    insert("phone_calls", {
      id: p.call,
      tenant_id: p.tenants[0],
      provider: "simwood",
      provider_call_id: "playback-" + p.runId,
      duration_seconds: 8,
      started_at: new Date().toISOString(),
      raw_payload: { synthetic: true },
    });
  p.storagePath = p.tenants[0] + "/" + p.runId + "/generated.wav";
  seed +=
    insert("phone_recordings", {
      id: p.recording,
      tenant_id: p.tenants[0],
      provider: "simwood",
      provider_call_id: "playback-" + p.runId,
      provider_recording_id: "playback-" + p.runId,
      duration_seconds: 8,
      storage_path: p.storagePath,
      file_size: 128044,
      raw_payload: { synthetic: true },
    }) +
    insert("phone_recordings", {
      id: p.foreignRecording,
      tenant_id: p.tenants[1],
      provider: "simwood",
      provider_call_id: "playback-" + p.runId,
      provider_recording_id: "playback-" + p.runId,
      raw_payload: { synthetic: true },
    });
  seed += insert("interactions", {
    id: p.interaction,
    tenant_id: p.tenants[0],
    source_connector_id: "simwood",
    source_type: "communication",
    source_table: "phone_calls",
    source_id: p.call,
    interaction_type: "message",
    occurred_at: new Date().toISOString(),
    subject: "SYNTHETIC retained call audio",
    status: "active",
    related_company_id: p.company,
    related_person_id: p.person,
    metadata: { synthetic: true },
  });
  seed += "commit;";
  await sql(seed, false);
  p.seeded = true;
  save(p);
  const wav = Buffer.alloc(128044);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(128000, 40);
  for (let n = 0; n < 64000; n++)
    wav.writeInt16LE(Math.round(1500 * Math.sin((n * 2 * Math.PI * 220) / 8000)), 44 + n * 2);
  p.audioSha256 = createHash("sha256").update(wav).digest("hex");
  save(p);
  const upload = await storage.storage
    .from("phone-recordings")
    .upload(p.storagePath, wav, { contentType: "audio/wav", upsert: false });
  check(!upload.error);
  p.state = "active";
  save(p);
  console.log(
    JSON.stringify({
      state: p.state,
      runId: p.runId,
      email: p.email,
      tenant: p.tenants[0],
      user: p.user,
      source: "synthetic generated audio only",
      credentials: "Private local session file; never print password",
    }),
  );
} else if (mode === "--verify") {
  check(p.state === "active" && Date.now() - Date.parse(p.startedAt) < 1800000);
  const login = await request(
    "/auth/v1/token?grant_type=password",
    "POST",
    { email: p.email, password: p.password },
    { apikey: anon },
  );
  check(login.ok && login.data.user.id === p.user);
  const jwt = login.data.access_token,
    client = createClient(base, anon, {
      global: { headers: { Authorization: "Bearer " + jwt } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  const detail = await readLearnCardDetail(client, p.tenants[0], "customer", p.card);
  check(detail.evidence.some((e) => e.sourceId === p.call));
  const page = await readRetainedRecordings(client, p.tenants[0], "phone_calls", p.call);
  check(page.rows.length === 1 && page.rows[0].id === p.recording);
  const link = await openRetainedRecording(client, p.tenants[0], p.recording, base);
  const r = await fetch(link.url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  check(r.ok);
  const bytes = Buffer.from(await r.arrayBuffer());
  check(
    bytes.length === 128044 && createHash("sha256").update(bytes).digest("hex") === p.audioSha256,
  );
  const deny = await request(
    "/functions/v1/learn-phone-playback",
    "POST",
    { tenant_id: p.tenants[1], recording_id: p.foreignRecording },
    { apikey: anon, Authorization: "Bearer " + jwt },
  );
  check(deny.status === 403);
  await sql(
    `update profiles set role='viewer' where id=${q(p.user)} and tenant_id=${q(p.tenants[0])}`,
    false,
  );
  const revoked = await request(
    "/functions/v1/learn-phone-playback",
    "POST",
    { tenant_id: p.tenants[0], recording_id: p.recording },
    { apikey: anon, Authorization: "Bearer " + jwt },
  );
  check([401, 403].includes(revoked.status));
  await sql(
    `update profiles set role='owner' where id=${q(p.user)} and tenant_id=${q(p.tenants[0])} and role='viewer'`,
    false,
  );
  const audit = await sql(
    `select count(*)::int as count from learn_phone_playback_audit where actor_id=${q(p.user)} and tenant_id=${q(p.tenants[0])} and recording_id=${q(p.recording)}`,
  );
  check(audit[0]?.count === 1);
  check(JSON.stringify(p.baseline) === JSON.stringify(await snapshot()));
  p.httpVerifiedAt = new Date().toISOString();
  save(p);
  console.log(
    JSON.stringify({
      state: "signed_in_synthetic_http_verified",
      runId: p.runId,
      cardSourceLinked: true,
      exactAudioBytes: bytes.length,
      auditReceipts: 1,
      foreignTenantDenied: true,
      sameSessionDemotionDenied: true,
      preservedDataSets: p.baseline.length,
      browserVerified: false,
    }),
  );
} else {
  const user = await request("/auth/v1/admin/users/" + p.user, "GET", undefined, admin);
  check(user.ok && user.data.app_metadata?.learn_playback_run === p.runId);
  const ban = await request(
    "/auth/v1/admin/users/" + p.user,
    "PUT",
    { ban_duration: "876000h", password: randomBytes(48).toString("base64url") },
    admin,
  );
  check(ban.ok && Date.parse(ban.data.banned_until) > Date.now() + 86400000);
  await sql(
    `update profiles set role='viewer',tenant_id=null where id=${q(p.user)} and email=${q(p.email)}`,
    false,
  );
  const retired = await sql(`select role,tenant_id from profiles where id=${q(p.user)}`);
  check(retired[0]?.role === "viewer" && retired[0].tenant_id === null);
  check(JSON.stringify(p.baseline) === JSON.stringify(await snapshot()));
  delete p.password;
  p.state = "retired";
  p.retiredAt = new Date().toISOString();
  save(p);
  console.log(
    JSON.stringify({
      state: "retired",
      runId: p.runId,
      banned: true,
      tenantAccessRemoved: true,
      syntheticEvidenceRetained: true,
      preservedDataSets: p.baseline.length,
    }),
  );
}
