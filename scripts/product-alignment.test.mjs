import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/routes/app.tsx", import.meta.url), "utf8");
const cards = readFileSync(new URL("../src/lib/customer-cards.ts", import.meta.url), "utf8");
const comms = readFileSync(
  new URL("../src/components/app/Communications.tsx", import.meta.url),
  "utf8",
);
const learning = readFileSync(new URL("../src/lib/learning-centre.ts", import.meta.url), "utf8");

const primary = [
  "Command Centre",
  "Communications",
  "Customers",
  "Operations",
  "Learning Centre",
  "Agents",
  "Protocol",
  "Settings",
];
for (const label of primary) assert.match(app, new RegExp(`label: "${label}"`));
assert.equal(
  (app.match(/group: "CORE"/g) ?? []).length,
  8,
  "exactly eight primary navigation items",
);
assert.match(app, /window\.location\.hash/, "view survives refresh through URL state");
assert.match(cards, /Array\.isArray\(operations\.waiting\)/, "legacy card arrays are normalised");
assert.match(comms, /listInteractions/, "communications uses canonical interactions");
assert.match(comms, /phone_call/);
assert.match(comms, /email_message/);
assert.match(learning, /graph_events/);
assert.match(learning, /intelligence_objects/);
console.log("Product alignment checks passed");
