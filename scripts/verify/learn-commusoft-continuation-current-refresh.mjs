/** One-shot reconciliation of recorded TEST 061–079 changes; hosted reads only.
 * Original rows are compared in their original column shape. New fixture rows
 * enter the new baseline only after exact identity/count and old-data checks. */
import { readFile, open, lstat, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readPhoneHealthCatalog, PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import { readMicrosoftStatusCatalog } from "./learn-microsoft-status-catalog.mjs";
import {
  validateContinuationPlan,
  continuationPreservationQuery,
  CONTINUATION_SCHEMA,
} from "./learn-commusoft-continuation-session.mjs";
const RUN = "d764008e-8c8f-4837-999a-8d38b5e6e2d5";
const FULL_SCHEMA = "e9243d82b156c9ab535d7abf601a9aae";
const FILE = ".verification-results/commusoft-continuation-session.json";
export const FIXTURES = [
  {
    id: "4560685a-9814-4735-8753-ad1356f5bb22",
    metadata: {
      purpose: "phone-handoff-http",
      synthetic: true,
    },
  },
  {
    id: "e0980884-3854-4af2-bbdf-e30bfa74be86",
    metadata: {
      purpose: "phone-handoff-http",
      synthetic: true,
    },
  },
  {
    id: "2e21b4dc-ce58-4d2e-a552-d025299b5ea2",
    metadata: {
      purpose: "interaction-projection-http",
      synthetic: true,
    },
  },
  {
    id: "7cc33974-4051-48eb-b1e2-9af565468709",
    metadata: {
      purpose: "interaction-projection-http",
      synthetic: true,
    },
  },
  {
    id: "b6a09a70-e62c-4b79-a783-0693b6e996e9",
    metadata: {
      purpose: "processing-queue-http",
      synthetic: true,
    },
  },
  {
    id: "eab4d079-96ee-4252-8039-b23f69e85587",
    metadata: {
      purpose: "processing-request-http",
      synthetic: true,
    },
  },
  {
    id: "ed390000-aaaa-4000-8000-000000000001",
    metadata: {
      card_draft_service_fixture: "v1",
    },
  },
  {
    id: "ed390000-aaaa-4000-8000-000000000009",
    metadata: {
      card_draft_service_fixture: "v1",
    },
  },
  {
    id: "ed391000-aaaa-4000-8000-000000000001",
    metadata: {
      card_draft_service_fixture: "v3",
    },
  },
  {
    id: "ed391000-aaaa-4000-8000-000000000009",
    metadata: {
      card_draft_service_fixture: "v3",
    },
  },
  {
    id: "ec400710-aaaa-4000-8000-000000000001",
    metadata: {
      email_change_api_fixture: true,
    },
  },
  {
    id: "ce740001-aaaa-4000-8000-000000000001",
    metadata: {
      synthetic: true,
      learn_voicemail_run: "voicemail-queue-acceptance-ce740001",
    },
  },
  {
    id: "ea780120-aaaa-4000-8000-000000000001",
    metadata: {
      microsoft_http_fixture: true,
    },
  },
  {
    id: "ea780220-aaaa-4000-8000-000000000001",
    metadata: {
      microsoft_worker_fixture: true,
    },
  },
];
export const OBJECTS = [
  {
    id: "4a37acaa-41fa-47d2-8f91-bcdaa42500e8",
    bucket_id: "receptionist-voicemails",
    name: "ce740001-aaaa-4000-8000-000000000001/ce740001-aaaa-4000-8000-000000000002/39ae5f5e-d38c-4fc1-b1d5-2314cce9404e",
  },
  {
    id: "8e872276-73d5-40dd-ba99-be6ca5a0f6e7",
    bucket_id: "learn-voicemail-sources",
    name: "ce740001-aaaa-4000-8000-000000000001/39ae5f5e-d38c-4fc1-b1d5-2314cce9404e/aa039837-cee9-4bb3-8dfb-feb549718deb.eml",
  },
  {
    id: "92884507-c5f9-40d1-85b7-5df206db6e67",
    bucket_id: "learn-voicemail-sources",
    name: "ce730001-aaaa-4000-8000-000000000001/ce730001-aaaa-4000-8000-000000000003/ce730001-aaaa-4000-8000-000000000004.eml",
  },
  {
    id: "95f38837-8a26-444e-9d69-493f942164da",
    bucket_id: "receptionist-voicemails",
    name: "ce730001-aaaa-4000-8000-000000000001/ce730001-aaaa-4000-8000-000000000002/ce730001-aaaa-4000-8000-000000000003",
  },
];
const OLD_COLUMNS = [
  "id",
  "tenant_id",
  "source_connector_id",
  "source_type",
  "source_table",
  "source_id",
  "source_external_id",
  "interaction_type",
  "direction",
  "occurred_at",
  "subject",
  "summary",
  "body_preview",
  "from_address",
  "from_name",
  "to_addresses",
  "cc_addresses",
  "phone_from",
  "phone_to",
  "status",
  "processing_status",
  "sentiment",
  "priority",
  "related_person_id",
  "related_company_id",
  "related_thread_id",
  "related_job_id",
  "related_task_id",
  "metadata",
  "created_at",
  "updated_at",
];
export const DELTAS = {
  "public.email_messages": 227,
  "public.phone_calls": 6,
  "public.phone_recordings": 2,
  "public.phone_transcripts": 2,
  "public.interactions": 444,
  "public.people": 13,
  "public.companies": 6,
  "public.customer_cards": 13,
  "public.platform_jobs": 38,
  "public.feature_flags": 3,
  "public.tenants": 14,
  "public.email_accounts": 4,
  "public.email_sync_runs": 1,
  "public.email_threads": 3,
  "public.email_ingestion_checkpoints": 1,
  "public.email_ingestion_transitions": 3,
  "public.phone_sync_runs": 8,
  "public.phone_ai_insights": 2,
  "public.learn_email_job_attempts": 1,
  "public.audit_logs": 8,
  "storage.objects": 4,
};
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const ids = FIXTURES.map((t) => q(t.id)).join(",");
const check = (ok, m) => {
  if (!ok) throw Error(m);
};
const ordered = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const sha = (value) => createHash("sha256").update(value).digest("hex");
function complete(rows) {
  check(
    Array.isArray(rows) &&
      rows.length === 78 &&
      new Set(rows.map((r) => r.name)).size === 78 &&
      rows.every(
        (r) =>
          PHONE_HEALTH_PRESERVED.includes(r.name) &&
          Number.isSafeInteger(r.count) &&
          r.count >= 0 &&
          /^[a-f0-9]{32}$/.test(r.fingerprint),
      ),
    "Complete preserved datasets required",
  );
  return rows;
}
export function originalShapeQuery(plan) {
  return continuationPreservationQuery(plan)
    .split(" union all ")
    .map((part) => {
      const m = part.match(/from ([a-z_.]+) s where (.*)$/);
      check(m, "Unexpected preservation query shape");
      const [name, predicate] = m.slice(1);
      const source =
        name === "public.interactions"
          ? `(select ${OLD_COLUMNS.join(",")} from public.interactions)`
          : name;
      const exclusion =
        name === "storage.objects"
          ? `s.id::text not in (${OBJECTS.map((o) => q(o.id)).join(",")})`
          : `coalesce(to_jsonb(s)->>'tenant_id','') not in (${ids})${name === "public.tenants" ? ` and s.id::text not in (${ids})` : ""}`;
      // Parenthesise the original OR predicate, especially for feature_flags.
      return part.slice(0, m.index) + `from ${source} s where (${predicate}) and (${exclusion})`;
    })
    .join(" union all ");
}
export const IDENTITY_QUERY = `/* continuation_079_fixture_identity */ select
 (select count(*)::int from public.tenants where id::text in (${ids})) as tenants,
 (select count(*)::int from public.tenants where status='archived' and (${FIXTURES.map((t) => `(id=${q(t.id)} and metadata=${q(JSON.stringify(t.metadata))}::jsonb)`).join(" or ")})) as marked_archived,
 (select count(*)::int from storage.objects where id::text in (${OBJECTS.map((o) => q(o.id)).join(",")})) as objects,
 (select count(*)::int from storage.objects where ${OBJECTS.map((o) => `(id=${q(o.id)} and bucket_id=${q(o.bucket_id)} and name=${q(o.name)})`).join(" or ")}) as marked_objects,
 (select count(*)::int from storage.buckets where id in ('receptionist-voicemails','learn-voicemail-sources') and public=false) as private_buckets,
 (select count(*)::int from public.interactions where tenant_id::text not in (${ids}) and (source_updated_at is not null or source_version is not null)) as changed_original_provenance,
 (select count(*)::int from auth.users u join public.profiles p on p.id=u.id where p.tenant_id::text in (${ids}) and coalesce(u.banned_until,'-infinity')<=now()) as active_fixture_logins`;
export async function refreshCurrentContinuation(
  plan,
  { query, catalog, fullCatalog, now = () => new Date().toISOString() },
) {
  validateContinuationPlan(plan);
  check(
    plan.runId === RUN &&
      plan.state === "prepared" &&
      !plan.password &&
      !plan.compatibility079 &&
      plan.compatibility058?.originalDataMatched === true,
    "Original prepared run can refresh once",
  );
  const before = complete(plan.before);
  const schemas = async () =>
    check(
      (await catalog()).fingerprint === CONTINUATION_SCHEMA &&
        (await fullCatalog()).fingerprint === FULL_SCHEMA,
      "Reviewed TEST 079 catalog required",
    );
  await schemas();
  const verifyIdentity = async () => {
    const r = await query(IDENTITY_QUERY);
    check(
      r.length === 1 &&
        r[0].tenants === 14 &&
        r[0].marked_archived === 14 &&
        r[0].objects === 4 &&
        r[0].marked_objects === 4 &&
        r[0].private_buckets === 2 &&
        r[0].changed_original_provenance === 0 &&
        r[0].active_fixture_logins === 0,
      "Fixture or original provenance differs",
    );
  };
  await verifyIdentity();
  const oldQuery = originalShapeQuery(plan),
    currentQuery = continuationPreservationQuery(plan);
  check(ordered(complete(await query(oldQuery))) === ordered(before), "Original data differs");
  const current = complete(await query(currentQuery));
  for (const row of current) {
    const b = before.find((r) => r.name === row.name),
      delta = DELTAS[row.name] ?? 0;
    check(
      row.count === b.count + delta && (delta > 0 || row.fingerprint === b.fingerprint),
      "Unexplained retained-data change",
    );
  }
  check(
    ordered(complete(await query(currentQuery))) === ordered(current) &&
      ordered(complete(await query(oldQuery))) === ordered(before),
    "Data changed during comparison",
  );
  await verifyIdentity();
  await schemas();
  const next = structuredClone(plan);
  next.before = [...current].sort((a, b) => a.name.localeCompare(b.name));
  next.preserved = true;
  next.compatibility079 = {
    version: "commusoft-continuation-079/1",
    checkedAt: now(),
    schemaFingerprint: CONTINUATION_SCHEMA,
    fullSchemaFingerprint: FULL_SCHEMA,
    priorBaseline: before,
    priorBaselineSha256: sha(ordered(before)),
    currentBaselineSha256: sha(ordered(current)),
    originalDataMatched: true,
    expectedAddedRows: DELTAS,
    fixtureTenants: FIXTURES.map((t) => t.id),
    fixtureStorageObjects: OBJECTS.map((o) => o.id),
    originalInteractionAddedColumnsNull: true,
  };
  return next;
}
export const summary = (p) => ({
  state: p.state,
  projectRef: p.projectRef,
  runId: p.runId,
  ...Object.fromEntries(Object.entries(p.compatibility079).filter(([k]) => k !== "priorBaseline")),
  protectedDatasets: 78,
  newUsers: 0,
  newGrants: 0,
  providerRequests: 0,
  productionChanged: false,
  activationApproval: "still_required",
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pending;
  try {
    check(
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT &&
        process.argv.slice(2).join(" ") === "--refresh-prepared-run " + RUN,
      "Exact TEST scope required",
    );
    const st = await lstat(FILE);
    check(
      st.isFile() &&
        !st.isSymbolicLink() &&
        st.uid === process.getuid() &&
        (st.mode & 0o777) === 0o600,
      "Private journal required",
    );
    const h = await open(FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw;
    try {
      raw = await h.readFile("utf8");
    } finally {
      await h.close();
    }
    const token = savedCliToken(),
      next = await refreshCurrentContinuation(JSON.parse(raw), {
        query: (s) => communicationQuery(token, s, { readOnly: true }),
        catalog: () => readPhoneHealthCatalog(token),
        fullCatalog: () => readMicrosoftStatusCatalog(token),
      });
    check((await readFile(FILE, "utf8")) === raw, "Prepared journal changed");
    const backup = await open(
      ".verification-results/commusoft-continuation-before-refresh-079.json",
      "wx",
      0o600,
    );
    try {
      await backup.writeFile(raw);
      await backup.sync();
    } finally {
      await backup.close();
    }
    pending = FILE + ".pending-" + randomUUID();
    const out = await open(pending, "wx", 0o600);
    try {
      await out.writeFile(JSON.stringify(next, null, 2) + "\n");
      await out.sync();
    } finally {
      await out.close();
    }
    check((await readFile(FILE, "utf8")) === raw, "Prepared journal changed");
    await rename(pending, FILE);
    pending = null;
    const dir = await open(".verification-results", "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    console.log(JSON.stringify(summary(next), null, 2));
  } catch {
    if (pending) await unlink(pending).catch(() => {});
    console.error("Read-only reconciliation failed; inspect before retry.");
    process.exitCode = 1;
  }
}
