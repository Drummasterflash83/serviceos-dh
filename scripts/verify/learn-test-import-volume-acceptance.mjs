/** Measured, synthetic TEST import at 1,200 or 5,000 rows. No automatic write retries. */
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { mapRow } from "../../supabase/functions/_shared/imports/profile.ts";
import { loadGovernedOutcomes } from "../../src/lib/learn-imports.ts";
import { readLearnCards } from "../../src/lib/learn-cards.ts";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readImportBatchesCatalog } from "./learn-import-batches-catalog.mjs";
import { IMPORT_ENDPOINT_SHA } from "./learn-test-import-pagination-deploy.mjs";
import { installedImportPaginationEndpoint } from "./learn-test-import-pagination-endpoint-catalog.mjs";
import { AUTH_CONTRACT_QUERY } from "./learn-test-auth-contract.mjs";
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
const check = (v, s) => {
    if (!v) throw Error(s);
  },
  q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const args = process.argv.slice(2),
  rowCount = args.length === 2 ? 1200 : Number(args[3]),
  resumePrefix = args.length === 6 && args[4] === "--resume-prefix" ? Number(args[5]) : 0;
check(
  args[0] === "--accept" &&
    args[1] === "--existing-cli-login" &&
    (args.length === 2 || ([4, 6].includes(args.length) && args[2] === "--rows")) &&
    (args.length !== 6 || (rowCount === 5000 && resumePrefix === 1200)) &&
    [1200, 5000].includes(rowCount) &&
    process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
  "Explicit synthetic TEST volume acceptance required",
);
const token = savedCliToken(),
  base = `https://${TEST_PROJECT}.supabase.co`,
  management = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const catalog = await readImportBatchesCatalog({ allowProjectRef: TEST_PROJECT, token });
check(installedImportPaginationEndpoint(catalog), "Exact TEST import/card release required");
async function request(url, headers, method = "GET", body, timeout = 45000) {
  return readAcceptanceResponse(
    await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    }),
  );
}
async function sql(query, readOnly = true) {
  const r = await request(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
    management,
    "POST",
    { query, ...(readOnly ? {} : { read_only: false }) },
  );
  check(r.ok, `Volume SQL failed (${r.status})`);
  return r.data;
}
const auth = await sql(AUTH_CONTRACT_QUERY);
check(
  auth?.length === 1 && actionAuthContractMatches(auth[0].contract),
  "Auth fixture contract differs",
);
const keys = await request(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  management,
);
check(keys.ok && Array.isArray(keys.data), "TEST keys unavailable");
const keyFor = (role) => {
  const a = keys.data.filter((k) => k.name === role);
  check(a.length === 1, "Unique TEST credential required");
  const v = a[0].api_key,
    c = JSON.parse(Buffer.from(v.split(".")[1], "base64url").toString());
  check(c.ref === TEST_PROJECT && c.role === role, "TEST credential target differs");
  return v;
};
const anon = keyFor("anon"),
  service = keyFor("service_role"),
  admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
const p = {
  version: "learn-test-import-volume/4",
  projectRef: TEST_PROJECT,
  sourceBundleSha256: IMPORT_ENDPOINT_SHA,
  runId: randomUUID(),
  tenant: randomUUID(),
  user: randomUUID(),
  rows: rowCount,
  resumePrefix,
  created: false,
  seeded: false,
  retired: false,
  phase: "prepared",
  timings: [],
  failure: null,
  cleanupErrors: [],
};
p.email = `learn-volume-${p.runId}@example.invalid`;
const manifest = `/private/tmp/serviceos-learn-volume-${p.runId}.json`,
  save = () => writeFileSync(manifest, JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
writeFileSync(manifest, JSON.stringify(p, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const names = [
  "email_messages",
  "phone_calls",
  "phone_recordings",
  "phone_transcripts",
  "slack_messages",
  "slack_message_versions",
  "interactions",
  "sites",
  "jobs",
  "people",
  "companies",
  "contact_points",
  "data_imports",
  "import_entity_links",
  "import_row_results",
  "import_row_provenance",
  "import_conflicts",
  "customer_cards",
];
async function sources() {
  return (
    await sql(
      names
        .map(
          (n) =>
            `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${n} s where tenant_id<>${q(p.tenant)}`,
        )
        .join(" union all "),
    )
  ).sort((a, b) => a.name.localeCompare(b.name));
}
async function counts() {
  return (
    await sql(
      `select (select count(*)::int from people where tenant_id=${q(p.tenant)}) as people,(select count(*)::int from customer_cards where tenant_id=${q(p.tenant)}) as cards,(select count(*)::int from import_entity_links where tenant_id=${q(p.tenant)}) as links,(select count(*)::int from import_row_results where tenant_id=${q(p.tenant)}) as outcomes,(select count(*)::int from import_row_provenance where tenant_id=${q(p.tenant)}) as provenance,(select count(*)::int from import_row_results where tenant_id=${q(p.tenant)} and (attempt<>1 or outcome<>'created')) as unexpected_outcomes`,
    )
  )[0];
}
async function prefixFingerprint() {
  const outcomeScope = `tenant_id=${q(p.tenant)} and import_id=${q(p.importId)} and row_number between 2 and ${resumePrefix + 1}`;
  const identities = `select entity_id from import_row_results where ${outcomeScope} and entity_table='people'`;
  const scopes = {
    people: `id in (${identities})`,
    customer_cards: `person_id in (${identities})`,
    import_entity_links: `entity_table='people' and entity_id in (${identities})`,
    import_row_results: `import_id=${q(p.importId)} and row_number between 2 and ${resumePrefix + 1}`,
    import_row_provenance: `import_id=${q(p.importId)} and source_row_number between 2 and ${resumePrefix + 1}`,
  };
  return (
    await sql(
      Object.entries(scopes)
        .map(
          ([name, scope]) =>
            `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${name} s where tenant_id=${q(p.tenant)} and (${scope})`,
        )
        .join(" union all "),
    )
  ).sort((a, b) => a.name.localeCompare(b.name));
}
let session;
const edge = async (body) => {
  const start = Date.now(),
    phase = body.action;
  p.phase = phase + "_requested";
  save();
  console.error(`${phase} started for ${p.rows} synthetic rows`);
  let r;
  try {
    r = await request(
      `${base}/functions/v1/learn-data-import`,
      { apikey: anon, Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
      "POST",
      { tenant_id: p.tenant, ...body },
      600000,
    );
  } catch {
    p.timings.push({ action: phase, ms: Date.now() - start, state: "unknown" });
    save();
    throw Error(`${phase} outcome unknown; inspect saved run before any retry`);
  }
  p.timings.push({ action: phase, ms: Date.now() - start, status: r.status });
  save();
  check(
    r.ok && r.data?.success === true,
    `${phase} failed HTTP ${r.status} (${String(r.data?.error?.code ?? "unknown")})`,
  );
  console.error(`${phase} finished in ${Date.now() - start}ms`);
  return r.data;
};
try {
  p.sourceBefore = await sources();
  save();
  const password = randomBytes(36).toString("base64url");
  const made = await request(`${base}/auth/v1/admin/users`, admin, "POST", {
    id: p.user,
    email: p.email,
    password,
    email_confirm: true,
    app_metadata: { learn_volume_run: p.runId },
  });
  check(made.ok && made.data?.id === p.user, "Synthetic Auth creation failed");
  p.created = true;
  save();
  const login = await request(
    `${base}/auth/v1/token?grant_type=password`,
    { apikey: anon, "Content-Type": "application/json" },
    "POST",
    { email: p.email, password },
  );
  check(login.ok && login.data?.user?.id === p.user, "Synthetic sign-in failed");
  session = login.data.access_token;
  await sql(
    `begin;insert into tenants(id,slug,display_name,metadata) values(${q(p.tenant)},${q("learn-volume-" + p.runId)},'SYNTHETIC import volume',jsonb_build_object('learn_volume_run',${q(p.runId)},'synthetic',true));update profiles set tenant_id=${q(p.tenant)},role='owner' where id=${q(p.user)} and email=${q(p.email)};commit;`,
    false,
  );
  p.seeded = true;
  save();
  const profiles = await edge({ action: "profiles" }),
    profile = profiles.profiles?.find(
      (x) => x.entity_type === "customers" && x.definition?.governed === true,
    );
  check(profile, "Governed customer profile missing");
  const csv =
    "source_system,external_id,record_kind,display_name,active\n" +
    Array.from(
      { length: p.rows },
      (_, i) => `commusoft,VOLUME-${i + 1},person,SYNTHETIC Volume Customer ${i + 1},true`,
    ).join("\n");
  const preview = await edge({
    action: "preview",
    source_system: "commusoft",
    entity_type: "customers",
    profile_id: profile.id,
    filename: `SYNTHETIC-${p.rows}-customers.csv`,
    csv_text: csv,
  });
  p.importId = preview.import_id;
  save();
  check(
    preview.preview?.will_create === p.rows && preview.preview?.invalid === 0,
    "Preview totals differ",
  );
  check((await counts()).people === 0, "Preview changed canonical rows");
  if (resumePrefix) {
    // Stage the durable state left by committed batches, using the same private RPC
    // and sealed profile as Edge. No trigger/fault hook or schema change is installed.
    p.recovery = {
      mode: "staged committed prefix; final batch reply deliberately ignored",
      rows: resumePrefix,
      confirmedBatches: 0,
      ignoredFinalReply: false,
    };
    p.phase = "prefix_staging";
    save();
    const started = await sql(
      `update data_imports set status='importing',started_at=clock_timestamp() where id=${q(p.importId)} and tenant_id=${q(p.tenant)} and status='previewed' returning id`,
      false,
    );
    check(started.length === 1, "Prefix import state differs");
    const records = csv
      .split("\n")
      .slice(1)
      .map((row) => row.split(","));
    for (let offset = 0; offset < resumePrefix; offset += 100) {
      const rows = records.slice(offset, offset + 100).map((r, i) => {
        const mapped = mapRow(
          r,
          preview.preview.sealed.profile.definition,
          preview.preview.mapping,
          offset + i + 2,
        );
        check(mapped.errors.length === 0, "Synthetic prefix mapping invalid");
        return { row_number: offset + i + 2, record: mapped.record };
      });
      const r = await request(`${base}/rest/v1/rpc/learn_import_apply_batch`, admin, "POST", {
        p_tenant: p.tenant,
        p_import: p.importId,
        p_actor: p.user,
        p_entity: "customers",
        p_options: preview.preview.sealed.import_options,
        p_rows: rows,
      });
      if (offset + 100 === resumePrefix) {
        p.recovery.ignoredFinalReply = true;
        save();
        break;
      }
      check(
        r.ok &&
          Array.isArray(r.data) &&
          r.data.length === 100 &&
          r.data.every((x, i) => x.row_number === offset + i + 2 && x.result?.action === "created"),
        "Staged batch did not confirm every row",
      );
      p.recovery.confirmedBatches++;
      save();
    }
    // Inspect durable state before any continuation after the deliberately ignored reply.
    p.recovery.checkpoint = await counts();
    check(
      ["people", "cards", "links", "outcomes", "provenance"].every(
        (k) => p.recovery.checkpoint[k] === resumePrefix,
      ) && p.recovery.checkpoint.unexpected_outcomes === 0,
      "Committed prefix differs; do not continue",
    );
    p.recovery.prefixBefore = await prefixFingerprint();
    check(
      p.recovery.prefixBefore.every((t) => t.count === resumePrefix),
      "Prefix evidence missing",
    );
    const saved = await edge({ action: "status", import_id: p.importId });
    check(
      saved.import?.status === "importing" && saved.import?.row_count === p.rows,
      "Saved incomplete import is not visible",
    );
    p.recovery.visibleIncompleteStatus = true;
    save();
    const denied = async (text, status) => {
      const r = await request(
        `${base}/functions/v1/learn-data-import`,
        { apikey: anon, Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
        "POST",
        { action: "apply", tenant_id: p.tenant, import_id: p.importId, csv_text: text },
      );
      check(r.status === status && r.data?.success !== true, "Incomplete import rejection differs");
      check(
        JSON.stringify(await counts()) === JSON.stringify(p.recovery.checkpoint),
        "Rejected continuation changed counts",
      );
      check(
        JSON.stringify(await prefixFingerprint()) === JSON.stringify(p.recovery.prefixBefore),
        "Rejected continuation changed prefix",
      );
    };
    await denied(csv.replace("SYNTHETIC Volume Customer 1", "SYNTHETIC Altered Customer 1"), 409);
    p.recovery.changedFileRefused = true;
    save();
    await sql(
      `update profiles set role='viewer' where id=${q(p.user)} and tenant_id=${q(p.tenant)}`,
      false,
    );
    await denied(csv, 403);
    p.recovery.revokedAuthorityRefused = true;
    save();
    const restored = await sql(
      `update profiles set role='owner' where id=${q(p.user)} and tenant_id=${q(p.tenant)} and role='viewer' returning id`,
      false,
    );
    check(restored.length === 1, "Synthetic approving role could not be restored");
    p.phase = "continuation_after_inspection";
    save();
  }
  const applied = await edge({ action: "apply", import_id: p.importId, csv_text: csv });
  check(
    applied.status === "completed" && applied.created === p.rows && applied.unprocessed === 0,
    "Large import did not finish every row",
  );
  if (resumePrefix) {
    p.recovery.prefixAfter = await prefixFingerprint();
    check(
      JSON.stringify(p.recovery.prefixBefore) === JSON.stringify(p.recovery.prefixAfter),
      "Previously committed source/card/evidence rows changed",
    );
    p.recovery.prefixPreserved = true;
    save();
  }
  p.counts = await counts();
  check(
    ["people", "cards", "links", "outcomes", "provenance"].every((k) => p.counts[k] === p.rows) &&
      p.counts.unexpected_outcomes === 0,
    "Durable large-import counts differ",
  );
  save();
  const replay = await edge({ action: "apply", import_id: p.importId, csv_text: csv });
  p.replay = { already: replay.already, status: replay.import?.status, created: replay.created };
  save();
  check(
    replay.already === true && replay.import?.status === "completed" && replay.created === p.rows,
    "Completed replay response differs",
  );
  check(
    JSON.stringify(await counts()) === JSON.stringify(p.counts),
    "Completed replay changed canonical counts",
  );
  const client = createClient(base, anon, {
    global: { headers: { Authorization: `Bearer ${session}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const outcomePages = [],
    seen = [];
  let cursor = 1;
  p.phase = "outcome_pages";
  save();
  for (let pageIndex = 0; pageIndex < Math.ceil(p.rows / 100); pageIndex++) {
    const page = await loadGovernedOutcomes(client, p.tenant, p.importId, cursor);
    check(
      page.rows.every((r) => r.outcome === "created" && r.attempt === 1),
      "Outcome page contains an unexpected result",
    );
    seen.push(...page.rows.map((r) => r.row_number));
    outcomePages.push({
      afterRow: cursor,
      returned: page.rows.length,
      nextAfterRow: page.next_after_row,
    });
    if (page.next_after_row === null) break;
    cursor = page.next_after_row;
  }
  check(
    seen.length === p.rows &&
      seen.every((n, i) => n === i + 2) &&
      outcomePages.at(-1).nextAfterRow === null,
    "Complete outcome pagination has gaps, duplicates or missing termination",
  );
  const beyond = await loadGovernedOutcomes(client, p.tenant, p.importId, 5001);
  check(
    beyond.rows.length === 0 && beyond.next_after_row === null,
    "End cursor did not return an empty final page",
  );
  const replayPage = await loadGovernedOutcomes(client, p.tenant, p.importId, 101);
  check(
    replayPage.rows[0]?.row_number === 102 && replayPage.rows.at(-1)?.row_number === 201,
    "Previous/reloaded page cursor differs",
  );
  const filtered = await edge({
    action: "row_results",
    import_id: p.importId,
    after_row: 1,
    page_size: 200,
    outcomes: ["invalid"],
  });
  check(
    filtered.rows.length === 0 && filtered.next_after_row === null && !filtered.truncated,
    "Empty filtered ledger differs",
  );
  p.outcomePages = outcomePages;
  p.outcomeLedger = {
    total: seen.length,
    pages: outcomePages.length,
    exactRowSequence: true,
    emptyEndCursor: true,
    previousCursor: true,
    emptyFilter: true,
  };
  save();
  const pages = [];
  for (const n of [0, 1, Math.floor((p.rows - 1) / 24)])
    pages.push(await readLearnCards(client, p.tenant, "customer", n));
  check(
    pages[0].cards.length === 24 &&
      pages[1].cards.length === 24 &&
      pages[2].cards.length === (p.rows % 24 || 24) &&
      pages[0].hasMore &&
      pages[1].hasMore &&
      !pages[2].hasMore &&
      new Set(pages.flatMap((x) => x.cards.map((c) => c.id))).size === 48 + (p.rows % 24 || 24),
    "Customer card pagination differs",
  );
  p.cardPages = pages.map((x) => ({ page: x.page, returned: x.cards.length, hasMore: x.hasMore }));
  p.phase = "passed";
  save();
} catch (e) {
  p.failure = e instanceof Error ? e.message : "Volume acceptance failed";
  p.phase = "requires_inspection";
  save();
} finally {
  // Retire current write authority first, including after an uncertain Edge response.
  try {
    if (p.created)
      await sql(
        `update profiles set role='viewer' where id=${q(p.user)} and email=${q(p.email)}`,
        false,
      );
  } catch {
    p.cleanupErrors.push("Role retirement requires inspection");
  }
  try {
    const found = await request(`${base}/auth/v1/admin/users/${p.user}`, admin);
    if (found.status !== 404 || p.created) {
      check(
        found.ok && found.data?.app_metadata?.learn_volume_run === p.runId,
        "Fixture actor marker differs",
      );
      const ban = await request(`${base}/auth/v1/admin/users/${p.user}`, admin, "PUT", {
        ban_duration: "876000h",
        password: randomBytes(48).toString("base64url"),
      });
      check(
        ban.ok && Date.parse(ban.data?.banned_until) > Date.now() + 86400000,
        "Synthetic login retirement unverified",
      );
    }
  } catch {
    p.cleanupErrors.push("Login retirement requires inspection");
  }
  try {
    p.sourceAfter = await sources();
    check(
      JSON.stringify(p.sourceBefore) === JSON.stringify(p.sourceAfter),
      "Pre-existing source/card rows changed",
    );
    p.preExistingSourcesPreserved = true;
    p.counts = await counts();
    p.imports = await sql(
      `select id,status,row_count,created_records,invalid_rows,conflict_records from data_imports where tenant_id=${q(p.tenant)} order by created_at,id`,
    );
    const roles = await sql(`select role from profiles where id=${q(p.user)}`);
    check(
      !p.created || (roles.length === 1 && roles[0].role === "viewer"),
      "Synthetic approving authority remains",
    );
  } catch {
    p.cleanupErrors.push("Retention/preservation requires inspection");
  }
  p.retired = p.cleanupErrors.length === 0;
  p.observedAt = new Date().toISOString();
  save();
}
const result = {
  ...p,
  sourceBefore: undefined,
  sourceAfter: undefined,
  email: undefined,
  manifest,
  limitations: [
    "Synthetic customers only; sites, jobs and provider communication volumes are separate.",
    "Only the first, second and last card pages are read; every row outcome is read through the real client in bounded pages.",
    "One request at a time, no automatic mutation retries, and fixture records are retained.",
    "Optional recovery stages partial commits through the real private RPC and ignores its last reply; it does not induce a hosted Edge crash or network partition.",
  ],
};
console.log(JSON.stringify(result, null, 2));
if (p.failure || p.cleanupErrors.length) process.exitCode = 1;
