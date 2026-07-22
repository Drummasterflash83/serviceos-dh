// Command Centre artifact cleanup + flood-stop (DRY-RUN by default; deterministic; reversible).
//
// Removes ONLY deterministically-identified synthetic artifacts and stops the upstream
// generic-action flood. It NEVER touches real operational data, New Dawn objectives, or the
// 480+ real "Record a controlled internal note" actions (those are a pipeline concern, handled
// upstream by disabling the flood policy, not by deletion).
//
// Three parts, each independently gated and audited:
//   1. Delete Action objects with attributes.verification=true (remote-verification-harness) +
//      their object_state_history + objective_links. REFUSES any candidate lacking the flag.
//   2. Disable the tenant flood policy ("controlled internal note" vertical) via the SUPPORTED
//      enabled=false path (reversible; stops NEW generic actions). Does NOT delete existing ones.
//   3. Delete orphan test auth users — ONLY if each has no profile AND no team_member.
//
// Usage (LOCAL default; production requires explicit confirm):
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/cleanup/cc-artifact-cleanup.mjs           # dry-run
//   … --apply --confirm-project tgbnakbxwcqjeimygroz                                                    # execute
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const confirmIdx = args.indexOf("--confirm-project");
const CONFIRM = confirmIdx >= 0 ? args[confirmIdx + 1] : null;
const SUPA_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SR) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const projectRef = (() => { try { const h = new URL(SUPA_URL).hostname; const m = h.match(/^db\.([a-z0-9]+)\.supabase\.co$/) || h.match(/^([a-z0-9]+)\.supabase\.co$/); return m ? m[1] : (h.includes("127.0.0.1") || h.includes("localhost") ? "local" : h); } catch { return "?"; } })();
if (APPLY && projectRef !== "local" && CONFIRM !== projectRef) {
  console.error(`REFUSED: --apply against remote project '${projectRef}' requires --confirm-project ${projectRef}`);
  process.exit(1);
}
const db = createClient(SUPA_URL, SR, { auth: { persistSession: false } });
const DRUMMOND = "00000000-0000-0000-0000-000000000001";
const ORPHAN_EMAILS = ["cc-super@test.local", "cc-normal@test.local", "cc-other@test.local"];
const mode = APPLY ? "APPLY" : "DRY-RUN";
console.log(`=== CC artifact cleanup [${mode}] project=${projectRef} ===\n`);
const audit = { verificationActions: [], policyDisabled: null, orphanUsers: [] };

// ── Part 1: verification=true action objects ────────────────────────────────
const { data: verif } = await db.from("intelligence_objects")
  .select("id, subject, attributes").eq("tenant_id", DRUMMOND).eq("object_type", "Action")
  .contains("attributes", { verification: true });
console.log(`Part 1 — verification artifact actions: ${(verif ?? []).length}`);
for (const o of verif ?? []) {
  if (o.attributes?.verification !== true) { console.log(`  REFUSE ${o.id} (no verification flag)`); continue; }
  console.log(`  ${APPLY ? "DELETE" : "would delete"} ${o.id} "${o.subject}"`);
  audit.verificationActions.push(o.id);
  if (APPLY) {
    await db.from("object_state_history").delete().eq("object_id", o.id);
    await db.from("objective_links").delete().eq("target_ref", o.id);
    const { error } = await db.from("intelligence_objects").delete().eq("id", o.id).eq("tenant_id", DRUMMOND).contains("attributes", { verification: true });
    if (error) console.log(`   ERROR ${o.id}: ${error.message}`);
  }
}

// ── Part 2: disable the flood policy (reversible; supported enabled=false path) ──
const { data: pol } = await db.from("policies")
  .select("id, name, enabled").eq("tenant_id", DRUMMOND).ilike("name", "%controlled internal note%");
console.log(`\nPart 2 — flood policy: ${(pol ?? []).length} match(es)`);
for (const p of pol ?? []) {
  console.log(`  ${APPLY ? "DISABLE" : "would disable"} policy ${p.id} "${p.name}" (enabled=${p.enabled} → false)`);
  audit.policyDisabled = p.id;
  if (APPLY && p.enabled) {
    const { error } = await db.from("policies").update({ enabled: false }).eq("id", p.id).eq("tenant_id", DRUMMOND);
    if (error) console.log(`   ERROR: ${error.message}`); else console.log(`   disabled (re-enable: update policies set enabled=true where id='${p.id}')`);
  }
}

// ── Part 3: orphan test auth users (ONLY if no profile AND no team_member) ────
console.log(`\nPart 3 — orphan test auth users:`);
async function findUser(email) { for (let p = 1; p <= 25; p++) { const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 }); const u = data.users.find((x) => (x.email || "").toLowerCase() === email); if (u) return u; if (data.users.length < 200) break; } return null; }
for (const email of ORPHAN_EMAILS) {
  const u = await findUser(email);
  if (!u) { console.log(`  ${email}: absent ✓`); continue; }
  const { data: prof } = await db.from("profiles").select("id").eq("id", u.id).maybeSingle();
  const { data: mem } = await db.from("team_members").select("id").eq("profile_id", u.id);
  if (prof || (mem && mem.length)) { console.log(`  REFUSE ${email} (${u.id}) — has profile/membership, NOT an orphan`); continue; }
  console.log(`  ${APPLY ? "DELETE" : "would delete"} user ${email} (${u.id}) — no profile, no membership`);
  audit.orphanUsers.push(u.id);
  if (APPLY) { const { error } = await db.auth.admin.deleteUser(u.id); if (error) console.log(`   ERROR: ${error.message}`); }
}

console.log("\n=== AUDIT ===\n" + JSON.stringify(audit, null, 2));
console.log(APPLY ? "\nAPPLIED." : "\nDRY-RUN — no changes. Re-run with --apply --confirm-project <ref> to execute.");
