// Run: node supabase/functions/_shared/controlplane/email_boundary.verify.ts
// Pure unit tests for the tenant email-domain boundary. No DB, no network.
//
// A connected directory may be a shared administrative connection able to see several
// domains. Tenant membership must therefore NEVER be inferred from the connection, the
// authorising Google account, or the OpenFolk operator's own address — only from an
// explicitly approved tenant domain. Missing configuration means import NOTHING.
import assert from "node:assert/strict";
import { emailBoundaryDecision, emailDomain } from "./discovery.ts";

let failed = 0;
function ok(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}

const DRUMMONDS = ["drummondheating.co.uk"];

ok("DEFAULT-DENY: no approved domains configured imports nothing", () => {
  for (const a of ["someone@drummondheating.co.uk", "chris@allkin.co", "x@openfolk.ai"]) {
    const d = emailBoundaryDecision(a, []);
    assert.equal(d.eligible, false, `${a} must be denied`);
    assert.equal((d as { reason: string }).reason, "no_approved_domains");
  }
});
ok("approved-domain identity is eligible", () => {
  const d = emailBoundaryDecision("julie@drummondheating.co.uk", DRUMMONDS);
  assert.equal(d.eligible, true);
  assert.equal(d.domain, "drummondheating.co.uk");
});
ok("REGRESSION: allkin.co identity is excluded from the Drummonds tenant", () => {
  const d = emailBoundaryDecision("chris@allkin.co", DRUMMONDS);
  assert.equal(d.eligible, false);
  assert.equal((d as { reason: string }).reason, "outside_approved_domain");
  assert.equal(d.domain, "allkin.co");
});
ok("REGRESSION: the OpenFolk operator's own domain is excluded", () => {
  const d = emailBoundaryDecision("chris@openfolk.ai", DRUMMONDS);
  assert.equal(d.eligible, false);
  assert.equal((d as { reason: string }).reason, "outside_approved_domain");
});
ok("case and whitespace are normalised", () => {
  assert.equal(emailBoundaryDecision("  Julie@DrummondHeating.CO.UK ", DRUMMONDS).eligible, true);
});
ok("missing address is skipped, not excluded", () => {
  for (const a of [null, undefined, "", "   "]) {
    const d = emailBoundaryDecision(a, DRUMMONDS);
    assert.equal(d.eligible, false);
    assert.equal((d as { reason: string }).reason, "no_address");
  }
});
ok("look-alike domains do not pass (no suffix matching)", () => {
  for (const a of [
    "x@notdrummondheating.co.uk",
    "x@drummondheating.co.uk.evil.com",
    "x@sub.drummondheating.co.uk",
  ]) {
    assert.equal(emailBoundaryDecision(a, DRUMMONDS).eligible, false, `${a} must be denied`);
  }
});
ok("multiple approved domains are honoured independently", () => {
  const multi = ["drummondheating.co.uk", "drummonds.example"];
  assert.equal(emailBoundaryDecision("a@drummonds.example", multi).eligible, true);
  assert.equal(emailBoundaryDecision("a@allkin.co", multi).eligible, false);
});
ok("emailDomain extracts the domain after the LAST @", () => {
  assert.equal(emailDomain("weird@name@drummondheating.co.uk"), "drummondheating.co.uk");
  assert.equal(emailDomain("noatsign"), "");
});

console.log(
  failed === 0 ? "\nemail_boundary.verify: ALL PASSED" : `\nemail_boundary.verify: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
