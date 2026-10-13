import test from "node:test";
import assert from "node:assert/strict";
import {
  naturalDeliveryPrompt,
  NATURAL_DELIVERY_RULES,
} from "../../supabase/functions/_shared/receptionist-natural-delivery.ts";

test("delivery edit preserves business rules on both sides of the targeted section", () => {
  const before =
    "# Safety\nRequired safety wording unchanged.\n\n## Voice and conduct\n\n- Existing voice identity.\n- Existing conduct.\n\n## Routes\nExact destinations unchanged.\n# Hours\nConsent rules unchanged.\n";
  const after = naturalDeliveryPrompt(before);
  assert.ok(after.startsWith(before.slice(0, before.indexOf("\n\n## Routes"))));
  assert.ok(after.endsWith(before.slice(before.indexOf("\n## Routes"))));
  assert.equal(after.split(NATURAL_DELIVERY_RULES.trim()).length, 2);
  assert.throws(() => naturalDeliveryPrompt(after), /Review/);
});

test("changed or ambiguous prompt layout cannot receive an unreviewed style edit", () => {
  for (const source of [
    "different prompt",
    "## Voice and conduct\nno later section",
    "## Voice and conduct\n## Voice and conduct\n# Routes",
  ])
    assert.throws(() => naturalDeliveryPrompt(source));
});
