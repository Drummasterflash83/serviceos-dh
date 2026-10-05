import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { phoneRouteSections, type RecordedPhoneRoute } from "./phone-route-layout.ts";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261023190000_phone_reference.sql", import.meta.url),
  "utf8",
);
const reference = JSON.parse(migration.split("$reference$")[1]) as { routes: RecordedPhoneRoute[] };

test("office hours keeps every recorded option and the separate fallback", () => {
  const [section] = phoneRouteSections(reference.routes[0]);
  assert.equal(section.menu, "501");
  assert.deepEqual(
    section.rows.map((r) => [r.trigger, r.destination, r.extension]),
    [
      ["Press 1", "Mary", "103"],
      ["Press 2", "Liz", "102"],
      ["Press 3", "Tony", "105"],
      ["Press 4", "Mary", "103"],
      ["No choice / invalid choice", "Ring group", "304"],
    ],
  );
  assert.equal(section.rows[4].fallback, true);
});

test("out of hours separates the mobile, voicemail and invalid-choice routes", () => {
  const [section] = phoneRouteSections(reference.routes[1]);
  assert.equal(section.menu, "502");
  assert.deepEqual(
    section.rows.map((r) => [r.trigger, r.destination, r.extension]),
    [
      ["Press 1", "Rob Mobile", "201"],
      ["Press 2", "Shared voicemail", "601"],
      ["No choice / invalid choice", "Shared voicemail", "601"],
    ],
  );
  assert.match(section.note!, /England\/Wales holidays/);
});

test("unanswered calls and voicemail notifications are distinct functions", () => {
  const sections = phoneRouteSections(reference.routes[2]);
  assert.deepEqual(
    sections.map((s) => s.kind),
    ["fallback", "voicemail"],
  );
  assert.equal(sections[0].rows[0].trigger, "Desk extensions 101–108");
  assert.equal(sections[0].rows[1].extension, "303");
  assert.equal(sections[1].rows[0].destination, "office@drummondheating.co.uk");
});

test("formatting preserves original evidence and never guesses new wording", () => {
  const before = JSON.stringify(reference);
  reference.routes.forEach(phoneRouteSections);
  assert.equal(JSON.stringify(reference), before);
  const unknown = {
    title: "New routing",
    detail: "Pending confirmation of a new destination.",
    date: "Today",
  };
  assert.deepEqual(phoneRouteSections(unknown), [
    { title: unknown.title, kind: "reference", note: unknown.detail, rows: [] },
  ]);
});
