/** One exact read-only compatibility check for the retired approved playback run.
 * Preserve prior bytes/baselines; no access, provider requests or hosted writes. */
import { readFile, open, lstat, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readPhoneHealthCatalog, PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import { readPhoneSavedResultsCatalog } from "./learn-phone-saved-results-catalog.mjs";
import {
  validateContinuationPlan,
  continuationPreservationQuery,
} from "./learn-commusoft-continuation-session.mjs";
const run = "d764008e-8c8f-4837-999a-8d38b5e6e2d5",
  playbackRun = "73e083fe-4195-49fb-89a2-7679b6eab517",
  schema = "b35981f6b70c615e9e234540ddff1777",
  savedSchema = "6632f3df219ea27a9ccc3f668f198f00";
const file = ".verification-results/commusoft-continuation-session.json";
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  check = (v, m) => {
    if (!v) throw Error(m);
  };
const ordered = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name))),
  hash = (v) => createHash("sha256").update(v).digest("hex");
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
  return rows;
}
export async function refreshAfterPlayback(
  plan,
  p,
  { query, catalog, savedCatalog, now = () => new Date().toISOString() },
) {
  validateContinuationPlan(plan);
  check(
    plan.runId === run &&
      plan.state === "prepared" &&
      !plan.password &&
      plan.compatibility057?.originalDataMatched === true &&
      !plan.compatibility058,
    "Original prepared run required",
  );
  check(
    p.runId === playbackRun &&
      p.projectRef === TEST_PROJECT &&
      p.state === "retired" &&
      !p.password &&
      p.httpVerifiedAt &&
      p.retiredAt &&
      p.user === "effb2fb2-0782-491b-9a49-5cf2a5ef9e4d" &&
      JSON.stringify(p.tenants) ===
        JSON.stringify([
          "b6da43b2-0eec-4a70-9117-5a325b6b2e25",
          "f671e7aa-07d7-44a2-8bfa-ebbe1f2607b9",
        ]),
    "Retired approved playback required",
  );
  const ids = {
    "public.phone_calls": [p.call],
    "public.phone_recordings": [p.recording, p.foreignRecording],
    "public.interactions": [p.interaction],
    "public.people": [p.person],
    "public.companies": [p.company],
    "public.customer_cards": [p.card],
    "public.profiles": [p.user],
    "public.tenants": p.tenants,
  };
  check(
    Object.values(ids)
      .flat()
      .every(
        (id) => typeof id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id),
      ),
    "Fixture IDs invalid",
  );
  const path = p.tenants[0] + "/" + playbackRun + "/generated.wav";
  check(p.storagePath === path, "Fixture path differs");
  check(
    (await catalog()).fingerprint === schema && (await savedCatalog()).fingerprint === savedSchema,
    "TEST release differs",
  );
  const identity = await query(`/* playback_retirement_identity */ select
 (select count(*)::int from public.tenants where id in (${p.tenants.map(q).join(",")}) and metadata->>'synthetic'='true' and metadata->>'learn_playback_run'=${q(playbackRun)}) as tenants,
 (select count(*)::int from auth.users where id=${q(p.user)} and raw_app_meta_data->>'learn_playback_run'=${q(playbackRun)} and banned_until>now()) as banned,
 (select count(*)::int from public.profiles where id=${q(p.user)} and role='viewer' and tenant_id is null) as retired,
 (select count(*)::int from storage.buckets where id='phone-recordings' and public=false) as private_bucket,
 (select count(*)::int from storage.objects where bucket_id='phone-recordings' and name=${q(path)} and (metadata->>'size')::bigint=128044) as generated_object`);
  check(
    identity.length === 1 &&
      identity[0].tenants === 2 &&
      identity[0].banned === 1 &&
      identity[0].retired === 1 &&
      identity[0].private_bucket === 1 &&
      identity[0].generated_object === 1,
    "Playback identity or retirement differs",
  );
  const original = continuationPreservationQuery(plan),
    before = complete(plan.before);
  const normalized = original.replace(/from ((?:public|storage)\.[a-z_]+) s where /g, (m, n) => {
    const exclusion = ids[n]
      ? `s.id not in (${ids[n].map(q).join(",")})`
      : n === "storage.objects"
        ? `not(s.bucket_id='phone-recordings' and s.name=${q(path)})`
        : null;
    return exclusion ? `from ${n} s where ${exclusion} and ` : m;
  });
  check(
    ordered(complete(await query(normalized))) === ordered(before),
    "Original retained data differs",
  );
  const current = complete(await query(original));
  const deltas = {
    ...Object.fromEntries(Object.entries(ids).map(([name, v]) => [name, v.length])),
    "storage.objects": 1,
  };
  for (const row of current) {
    const old = before.find((r) => r.name === row.name),
      delta = deltas[row.name] ?? 0;
    check(
      row.count === old.count + delta && (delta > 0 || row.fingerprint === old.fingerprint),
      "Unexpected TEST additions",
    );
  }
  check(
    ordered(complete(await query(original))) === ordered(current) &&
      ordered(complete(await query(normalized))) === ordered(before),
    "Baseline drift",
  );
  check(
    (await catalog()).fingerprint === schema && (await savedCatalog()).fingerprint === savedSchema,
    "TEST release changed",
  );
  const next = structuredClone(plan);
  next.before = [...current].sort((a, b) => a.name.localeCompare(b.name));
  next.preserved = true;
  next.compatibility058 = {
    version: "commusoft-playback-compatibility/1",
    checkedAt: now(),
    schemaFingerprint: schema,
    savedResultFingerprint: savedSchema,
    priorBaseline: before,
    priorBaselineSha256: hash(ordered(before)),
    currentBaselineSha256: hash(ordered(current)),
    retiredPlaybackRun: playbackRun,
    expectedAddedRows: deltas,
    originalDataMatched: true,
  };
  return next;
}
export const summary = (p) => ({
  state: p.state,
  runId: p.runId,
  projectRef: p.projectRef,
  ...Object.fromEntries(Object.entries(p.compatibility058).filter(([k]) => k !== "priorBaseline")),
  protectedDatasets: p.before.length,
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
      "Exact TEST scope required",
    );
    const st = await lstat(file);
    check(
      st.isFile() &&
        !st.isSymbolicLink() &&
        st.uid === process.getuid() &&
        (st.mode & 0o777) === 0o600,
      "Private journal required",
    );
    const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw;
    try {
      raw = await h.readFile("utf8");
    } finally {
      await h.close();
    }
    const p = JSON.parse(
        await readFile(".verification-results/phone-playback-session.json", "utf8"),
      ),
      token = savedCliToken();
    const next = await refreshAfterPlayback(JSON.parse(raw), p, {
      query: (s) => communicationQuery(token, s, { readOnly: true }),
      catalog: () => readPhoneHealthCatalog(token),
      savedCatalog: () => readPhoneSavedResultsCatalog(token),
    });
    check((await readFile(file, "utf8")) === raw, "Journal changed");
    const backup = await open(
      ".verification-results/commusoft-continuation-before-refresh-058.json",
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
      await out.writeFile(JSON.stringify(next, null, 2) + "\n");
      await out.sync();
    } finally {
      await out.close();
    }
    check((await readFile(file, "utf8")) === raw, "Journal changed");
    await rename(pending, file);
    pending = null;
    const d = await open(".verification-results", "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
    console.log(JSON.stringify(summary(next), null, 2));
  } catch (e) {
    console.error(JSON.stringify({ state: "refresh_unconfirmed", reason: e.message }));
    process.exitCode = 1;
  } finally {
    if (pending) await unlink(pending).catch(() => {});
  }
}
