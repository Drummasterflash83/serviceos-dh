// Run: node supabase/functions/_shared/health/redact.verify.ts
// Pure unit tests for excerpt PII redaction. No DB, no network. All inputs synthetic.
import assert from "node:assert/strict";
import { redactText } from "./redact.ts";

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

ok("masks UK mobile and landline numbers", () => {
  const r = redactText("call me on 07700 900123 or 0161 496 0000 please");
  assert.ok(!/07700|900123|0161/.test(r), r);
  assert.ok(r.includes("[number]"));
});

ok("masks email addresses", () => {
  const r = redactText("email jane.doe@example.co.uk about it");
  assert.ok(!/jane\.doe@/.test(r));
  assert.ok(r.includes("[email]"));
});

ok("masks UK postcodes", () => {
  for (const pc of ["SW1A 1AA", "M1 1AE", "CR2 6XH", "sw1a1aa"]) {
    const r = redactText(`they live at ${pc} near the park`);
    assert.ok(r.includes("[postcode]"), `${pc} -> ${r}`);
  }
});

ok("masks sort code and card number", () => {
  const r = redactText("sort 12-34-56 card 4111 1111 1111 1111 taken");
  assert.ok(r.includes("[sort-code]"), r);
  assert.ok(r.includes("[card]"), r);
  assert.ok(!/4111/.test(r));
});

ok("masks a street address", () => {
  const r = redactText("visit 42 Acacia Road tomorrow morning");
  assert.ok(r.includes("[address]"), r);
  assert.ok(!/Acacia/.test(r));
});

ok("leaves ordinary callback language intact", () => {
  const r = redactText("please call me back about my boiler quote");
  assert.equal(r, "please call me back about my boiler quote");
});

ok("deterministic", () => {
  const s = "ring 07700 900123 at SW1A 1AA";
  assert.equal(redactText(s), redactText(s));
});

console.log(failed === 0 ? "\nredact.verify: ALL PASSED" : `\nredact.verify: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
