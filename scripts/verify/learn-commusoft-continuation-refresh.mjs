/** One reviewed compatibility refresh. Hosted reads only; original evidence stays
 * immutable. Does not activate access, send provider requests or relax limits. */
import { readFile, open, lstat, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readPhoneHealthCatalog, PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import {
  CONTINUATION_SCHEMA,
  validateContinuationPlan,
  continuationPreservationQuery,
} from "./learn-commusoft-continuation-session.mjs";
const run = "d764008e-8c8f-4837-999a-8d38b5e6e2d5";
const file = ".verification-results/commusoft-continuation-session.json";
const fixtures = ["76b546af-076e-46fd-866e-ad7611c60ed1", "c9e44b8f-8fca-4df7-ad1a-73da45a3f52b"];
const ids = fixtures.map((id) => `'${id}'`).join(",");
const deltas = {
  "public.phone_recordings": 2,
  "public.phone_transcripts": 2,
  "public.tenants": 2,
  "public.phone_sync_runs": 6,
  "public.phone_ai_insights": 2,
  "public.audit_logs": 8,
};
const check = (v, m) => {
  if (!v) throw Error(m);
};
const ordered = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
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
    "Incomplete baseline",
  );
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}
export async function refreshPreparedContinuation(
  plan,
  { query, catalog, now = () => new Date().toISOString() },
) {
  validateContinuationPlan(plan);
  check(
    plan.runId === run && plan.state === "prepared" && !plan.password && !plan.compatibility057,
    "Only the original prepared run can refresh once",
  );
  const before = complete(plan.before);
  check((await catalog()).fingerprint === CONTINUATION_SCHEMA, "TEST release differs");
  const original = continuationPreservationQuery(plan);
  const normalized = original.replace(
    /from (public\.[a-z_]+) s where /g,
    (_m, n) =>
      `from ${n} s where coalesce(to_jsonb(s)->>'tenant_id','') not in (${ids}) ${n === "public.tenants" ? `and s.id::text not in (${ids})` : ""} and `,
  );
  const fixtureState = await query(
    `/* continuation_fixture_identity */ select count(*)::int as fixtures,count(*) filter(where status='archived' and metadata->>'synthetic'='true' and metadata->>'purpose'='phone-processing-http' and created_at>'${new Date(plan.cutoff).toISOString()}'::timestamptz)::int as expected from public.tenants where id::text in (${ids})`,
  );
  check(
    fixtureState.length === 1 && fixtureState[0].fixtures === 2 && fixtureState[0].expected === 2,
    "Recorded synthetic fixtures differ",
  );
  const old = complete(await query(normalized));
  check(ordered(old) === ordered(before), "Original retained data differs");
  const current = complete(await query(original));
  for (const row of current) {
    const prior = before.find((r) => r.name === row.name),
      delta = deltas[row.name] ?? 0;
    check(
      row.count === prior.count + delta && (delta > 0 || row.fingerprint === prior.fingerprint),
      "Unexpected TEST additions",
    );
  }
  check(ordered(complete(await query(original))) === ordered(current), "Current baseline changed");
  check(
    ordered(complete(await query(normalized))) === ordered(before),
    "Original retained data changed during refresh",
  );
  check(
    (await catalog()).fingerprint === CONTINUATION_SCHEMA,
    "TEST release changed during refresh",
  );
  const refreshed = structuredClone(plan);
  refreshed.before = current;
  refreshed.preserved = true;
  refreshed.compatibility057 = {
    version: "commusoft-continuation-compatibility/1",
    checkedAt: now(),
    schemaFingerprint: CONTINUATION_SCHEMA,
    priorBaseline: before,
    priorBaselineSha256: hash(ordered(before)),
    currentBaselineSha256: hash(ordered(current)),
    recordedSyntheticFixtures: fixtures,
    expectedAddedRows: deltas,
    originalDataMatched: true,
  };
  return refreshed;
}
export const refreshSummary = (p) => ({
  state: p.state,
  runId: p.runId,
  projectRef: p.projectRef,
  checkedAt: p.compatibility057.checkedAt,
  schemaFingerprint: p.compatibility057.schemaFingerprint,
  originalPreservedDatasets: p.compatibility057.priorBaseline.length,
  currentPreservedDatasets: p.before.length,
  expectedAddedRows: p.compatibility057.expectedAddedRows,
  priorBaselineSha256: p.compatibility057.priorBaselineSha256,
  currentBaselineSha256: p.compatibility057.currentBaselineSha256,
  originalDataMatched: true,
  newUsers: 0,
  newGrants: 0,
  providerRequests: 0,
  approval: "still_required_for_activation",
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pending;
  try {
    check(
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT &&
        process.argv.slice(2).join(" ") === "--refresh-prepared-run " + run,
      "Exact prepared TEST run required",
    );
    const st = await lstat(file);
    check(
      st.isFile() &&
        !st.isSymbolicLink() &&
        st.uid === process.getuid() &&
        (st.mode & 0o777) === 0o600,
      "Private regular journal required",
    );
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw;
    try {
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    const token = savedCliToken(),
      p = await refreshPreparedContinuation(JSON.parse(raw), {
        query: (q) => communicationQuery(token, q, { readOnly: true }),
        catalog: () => readPhoneHealthCatalog(token),
      });
    check((await readFile(file, "utf8")) === raw, "Prepared journal changed");
    // Retain original bytes separately before publishing the new baseline locally.
    const backup = await open(
      ".verification-results/commusoft-continuation-before-refresh-057.json",
      "wx",
      0o600,
    );
    try {
      await backup.writeFile(raw);
      await backup.sync();
    } finally {
      await backup.close();
    }
    pending = file + ".pending-" + randomUUID();
    const out = await open(pending, "wx", 0o600);
    try {
      await out.writeFile(JSON.stringify(p, null, 2) + "\n");
      await out.sync();
    } finally {
      await out.close();
    }
    check((await readFile(file, "utf8")) === raw, "Prepared journal changed before save");
    await rename(pending, file);
    pending = null;
    const dir = await open(".verification-results", "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    console.log(JSON.stringify(refreshSummary(p), null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "refresh_unconfirmed",
        reason: [
          "Original retained data differs",
          "Unexpected TEST additions",
          "Recorded synthetic fixtures differ",
          "TEST release differs",
          "Only the original prepared run can refresh once",
        ].includes(error?.message)
          ? error.message
          : "inspect_private_journal_before_retry",
      }),
    );
    process.exitCode = 1;
  } finally {
    if (pending) await unlink(pending).catch(() => {});
  }
}
