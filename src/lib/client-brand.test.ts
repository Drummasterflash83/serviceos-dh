import test from "node:test";
import assert from "node:assert/strict";
import { clientDisplayName, hasDrummondsBrand } from "./client-brand.ts";

test("Drummonds display identity is short without changing its stored tenant name", () => {
  assert.equal(clientDisplayName("Drummond Heating"), "Drummond's");
  assert.equal(hasDrummondsBrand("Drummond Heating"), true);
  assert.equal(clientDisplayName("Mitchell Cooper"), "Mitchell Cooper");
  assert.equal(hasDrummondsBrand("Mitchell Cooper"), false);
});
