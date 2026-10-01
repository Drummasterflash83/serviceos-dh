import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emailLabel, voicemailDuration, voicemailDate } from "./voicemails.ts";
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
test("email setup is not delivery evidence", () => {
  assert.equal(emailLabel("unknown"), "Email status unconfirmed");
  assert.equal(emailLabel("sent"), "Email sent");
  assert.equal(emailLabel("delivered"), "Email delivered");
  assert.equal(emailLabel("failed"), "Email needs attention");
});
test("unknown durations are never presented as zero", () => {
  assert.equal(voicemailDuration(null), "Duration unavailable");
  assert.equal(voicemailDuration(-1), "Duration unavailable");
  assert.equal(voicemailDuration(0), "0:00");
  assert.equal(voicemailDuration(61), "1:01");
});
test("dates are displayed in UK business time including BST", () => {
  assert.match(voicemailDate("2026-09-29T12:00:00Z"), /13:00/);
  assert.match(voicemailDate("2026-12-29T12:00:00Z"), /12:00/);
});
test("client navigation places voicemails immediately after about your receptionist", () => {
  const nav = read("../components/receptionist/ReceptionistNavigation.tsx");
  assert.match(nav, /id: "details"[\s\S]*?\},\s*\{ id: "voicemails"/);
  assert.match(read("../components/app/OperatorModules.tsx"), /view: "voicemails"/);
});
test("audio uses user RLS before creating a signed link, never accepts a URL or path from browser", () => {
  const fn = read("../../supabase/functions/receptionist-voicemail-recording/index.ts");
  assert.ok(fn.indexOf("userDb.auth.getUser()") < fn.indexOf('.from("receptionist_voicemails")'));
  assert.ok(fn.indexOf("error || !message") < fn.indexOf("const admin"));
  assert.match(fn, /\.eq\("tenant_id", body.tenantId\)/);
  assert.match(fn, /message.recording_path !== expectedPath/);
  assert.match(fn, /createSignedUrl\(expectedPath, 60\)/);
  assert.doesNotMatch(fn, /body\.(url|path|recording_path)|fetch\(/);
});
test("there is no blanket operator access or browser writes", () => {
  const sql = read("../../supabase/migrations/20261023210000_receptionist_voicemails.sql");
  assert.doesNotMatch(sql, /care_desk_operator\(|current_user_is_openfolk_operator\(/);
  assert.match(sql, /security invoker/);
  assert.match(
    sql,
    /g\.tenant_id=p_tenant and g\.mailbox_id=p_mailbox and g\.user_id=auth.uid\(\)/,
  );
  assert.match(sql, /email_evidence_reference/);
  assert.doesNotMatch(
    read("../components/receptionist/VoicemailInbox.tsx"),
    /\.insert\(|\.update\(|createSignedUrl|service_role/,
  );
});
