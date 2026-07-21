// ServiceOS — Controlled Phone Intelligence reprocessing (force re-analysis of frozen summaries).
//
// Finds calls whose canonical insight summary still exposes a known ASR mishearing (default
// "german …" for Drummond's own name), and re-runs phone-analyse-transcript with force=true so
// the summary is regenerated from the LATEST normalised transcript + tenant company context.
// Then re-projects interactions.summary. Raw transcript is never touched.
//
// SAFEGUARDS: tenant-scoped; DRY-RUN by default (APPLY=1 to write); LIMIT; idempotent (a fixed
// call no longer matches); before/after comparison; raw-transcript-unchanged assertion.
//
// Run (dry-run):  set -a && . ./.env.verify && set +a && node scripts/phone-reprocess.mjs
// Run (apply):    ... APPLY=1 node scripts/phone-reprocess.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL,
  SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) {
  console.error("MISSING SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const db = createClient(URL, SR, { auth: { persistSession: false } });
const TENANT = process.env.TENANT || "00000000-0000-0000-0000-000000000001";
const MATCH = new RegExp(process.env.MATCH || "german", "i");
const LIMIT = Number(process.env.LIMIT || 20);
const APPLY = process.env.APPLY === "1";
const R = (s) =>
  String(s ?? "")
    .replace(/\b\d{5,}\b/g, "#####")
    .replace(/\+?\d[\d ]{7,}\d/g, "<phone>");
const sumText = (s) =>
  typeof s === "string"
    ? s
    : s && typeof s === "object"
      ? s.text || s.summary || JSON.stringify(s)
      : "";

async function analyseForce(transcriptId) {
  const r = await fetch(`${URL}/functions/v1/phone-analyse-transcript`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SR}`,
      "x-internal-tenant-id": TENANT,
    },
    body: JSON.stringify({ tenant_id: TENANT, transcript_id: transcriptId, force: true }),
  });
  return { status: r.status, body: await r.text().catch(() => "") };
}

async function main() {
  // 1) affected insights (summary/identity exposes the mishearing)
  const { data: insights } = await db
    .from("phone_ai_insights")
    .select("id,recording_id,call_id,summary,identity_summary,updated_at")
    .eq("tenant_id", TENANT);
  const affected = (insights || [])
    .filter((r) => MATCH.test(sumText(r.summary) + " " + sumText(r.identity_summary)))
    .slice(0, LIMIT);
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} · tenant ${TENANT.slice(0, 8)} · match /${MATCH.source}/ · ${affected.length} affected insight(s) (limit ${LIMIT})\n`,
  );

  let fixed = 0,
    unchanged = 0,
    failed = 0,
    rawSafe = 0;
  for (const ins of affected) {
    // transcript for this recording (latest)
    const { data: tx } = await db
      .from("phone_transcripts")
      .select("id,transcript_text")
      .eq("tenant_id", TENANT)
      .eq("recording_id", ins.recording_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!tx) {
      console.log(`  call ${String(ins.call_id).slice(0, 8)}: no transcript — skip`);
      continue;
    }
    const rawBefore = tx.transcript_text;
    console.log(`  call ${String(ins.call_id).slice(0, 8)} tx ${tx.id.slice(0, 8)}`);
    console.log(`    BEFORE: ${R(sumText(ins.summary)).slice(0, 150)}`);
    if (!APPLY) {
      console.log("    (dry-run — not reprocessed)\n");
      continue;
    }

    const res = await analyseForce(tx.id);
    if (res.status !== 200) {
      console.log(`    FAILED (${res.status}): ${res.body.slice(0, 120)}\n`);
      failed++;
      continue;
    }
    // re-read insight + transcript
    const { data: after } = await db
      .from("phone_ai_insights")
      .select("summary,identity_summary,updated_at")
      .eq("tenant_id", TENANT)
      .eq("recording_id", ins.recording_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: txAfter } = await db
      .from("phone_transcripts")
      .select("transcript_text")
      .eq("id", tx.id)
      .maybeSingle();
    const afterSummary = sumText(after?.summary);
    const stillBad = MATCH.test(afterSummary + " " + sumText(after?.identity_summary));
    const rawUnchanged = txAfter?.transcript_text === rawBefore;
    if (rawUnchanged) rawSafe++;
    console.log(`    AFTER:  ${R(afterSummary).slice(0, 150)}`);
    console.log(
      `    raw transcript unchanged: ${rawUnchanged ? "yes ✓" : "NO ✗"} · mishearing gone: ${stillBad ? "no ✗" : "yes ✓"}\n`,
    );
    if (stillBad) unchanged++;
    else fixed++;
  }

  if (APPLY) {
    // 2) re-project interactions.summary from the refreshed insights
    const proj = await fetch(`${URL}/functions/v1/interactions-sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SR}`,
        "x-internal-tenant-id": TENANT,
      },
      body: JSON.stringify({ tenant_id: TENANT }),
    })
      .then((r) => r.status)
      .catch(() => "err");
    console.log(`re-projection (interactions-sync) → status ${proj}`);
    console.log(
      `\nRESULT: fixed ${fixed} · still-mishearing ${unchanged} · failed ${failed} · raw-safe ${rawSafe}/${fixed + unchanged}`,
    );
    process.exit(unchanged === 0 && failed === 0 ? 0 : 1);
  } else {
    console.log("Dry-run complete. Re-run with APPLY=1 to reprocess.");
  }
}
main().catch((e) => {
  console.error("REPROCESS ERROR:", e?.message ?? e);
  process.exit(1);
});
