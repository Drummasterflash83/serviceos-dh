import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { catalog, transport } from "./learn-commusoft-setup-test-fixture.mjs";
import { expectedVerificationEndpoint } from "./learn-test-commusoft-verification-runtime.mjs";
import {
  CONTACT_FUNCTION_QUERY,
  CONTACT_GRANTS_QUERY,
  CONTACT_FUNCTIONS,
  CONTACT_CHANGED_FUNCTIONS,
} from "./learn-commusoft-contacts-catalog.mjs";
import {
  contactPrior,
  contactExpected,
  contactPrerequisites,
  installedContacts,
  withoutContacts,
  contactFingerprint,
  contactSql,
  releaseContacts,
  confirmContacts,
  CONTACT_RELEASE,
  CONTACT_SHA,
  CONTACT_PRESERVED_TABLES,
  CONTACT_SNAPSHOT_QUERY,
} from "./learn-test-commusoft-contacts-release.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const args = { allowProjectRef: TEST_PROJECT, token: "sbp_" + "a".repeat(40) };
const compact = (f) => ({
  name: f.name,
  arguments: f.arguments,
  securityDefiner: f.securityDefiner,
  authenticatedExecute: f.authenticatedExecute,
  anonExecute: f.anonExecute,
});
function fixture(installed = false) {
  const c = catalog(true),
    p = contactPrior();
  c.base.functions.push(expectedVerificationEndpoint().endpoint);
  c.contactFunctions = p.functions;
  c.contactGrants = p.grants;
  c.tables = c.tables
    .map((t) => p.tables.find((x) => x.name === t.name) ?? t)
    .sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(contactPrerequisites(c), true);
  if (installed) {
    const e = contactExpected(),
      find = (n) => e.functions.find((f) => f.name === n);
    c.contactFunctions = c.contactFunctions
      .map((f) => find(f.name) ?? f)
      .concat(e.functions.filter((f) => CONTACT_FUNCTIONS.includes(f.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
    c.commusoftFunctions = c.commusoftFunctions.map((f) => find(f.name) ?? f);
    c.base.inventory.functions = c.base.inventory.functions
      .map((f) => (find(f.name) ? compact(find(f.name)) : f))
      .concat(e.functions.filter((f) => CONTACT_FUNCTIONS.includes(f.name)).map(compact))
      .sort((a, b) => a.name.localeCompare(b.name));
    const r = {
      migration_name: CONTACT_RELEASE,
      source_sha256: CONTACT_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T12:00:00Z",
    };
    c.readiness.customMigrationEntries.push(r);
    if (c.base.report.customMigrationEntries !== c.readiness.customMigrationEntries)
      c.base.report.customMigrationEntries.push(r);
  }
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}
function mock({ rehearse = false, lost = false, afterUnavailable = false, tamper = false } = {}) {
  let writes = 0,
    journal = null;
  const before = fixture(),
    after = fixture(true);
  const current = () => (writes && !rehearse ? after : before);
  const base = transport({ currentCatalog: current });
  const sources = () =>
    CONTACT_PRESERVED_TABLES.map((name, i) => ({
      name,
      count: tamper && writes && i === 0 ? 1 : 0,
      fingerprint: "a".repeat(32),
    }));
  return {
    get writes() {
      return writes;
    },
    get journal() {
      return journal;
    },
    persistJournal: async (j) => {
      journal = j;
    },
    fetcher: async (url, o) => {
      const q = o?.body ? JSON.parse(o.body).query : null;
      if (url.endsWith("/database/query")) {
        assert.ok(journal, "write precedes durable journal");
        writes++;
        assert.equal(writes, 1);
        if (lost) throw Error("Lost reply");
        return Response.json([
          { marker: "learn-test-commusoft-contacts/1", receipt_expected: true },
        ]);
      }
      if (writes && afterUnavailable) throw Error("Metadata temporarily unavailable");
      if (q === CONTACT_FUNCTION_QUERY)
        return Response.json([{ functions: current().contactFunctions }]);
      if (q === CONTACT_GRANTS_QUERY) return Response.json([{ grants: current().contactGrants }]);
      if (q === CONTACT_SNAPSHOT_QUERY) return Response.json(sources());
      return base.fetcher(url, o);
    },
  };
}
const rehearsal = () => ({
  version: "learn-test-commusoft-contacts/1",
  projectRef: TEST_PROJECT,
  sourceSha256: CONTACT_SHA,
  state: "rehearsed_and_rolled_back",
  acknowledged: true,
  preExistingSourcesPreserved: true,
  beforeFingerprint: contactFingerprint(fixture()),
  afterFingerprint: contactFingerprint(fixture()),
  observedAt: new Date().toISOString(),
});
test("compiled contact contract preserves existing tables, permissions, runtime and both receipt inventories", () => {
  const before = fixture(),
    after = fixture(true);
  assert.equal(installedContacts(after), true);
  assert.equal(contactFingerprint(withoutContacts(after)), contactFingerprint(before));
  for (const mutate of [
    (c) =>
      (c.base.report.customMigrationEntries = c.base.report.customMigrationEntries.slice(0, -1)),
    (c) =>
      (c.contactFunctions.find((f) => f.name === "learn_commusoft_confirm_contact").anonExecute =
        true),
    (c) =>
      (c.commusoftFunctions.find((f) => f.name === CONTACT_CHANGED_FUNCTIONS[0]).definition += " "),
    (c) => (c.tables.find((t) => t.name === "contact_points").rls = false),
    (c) => (c.base.functions.find((f) => f.slug === "learn-commusoft-verify").verify_jwt = false),
  ]) {
    const c = fixture(true);
    mutate(c);
    assert.equal(installedContacts(c), false);
  }
  assert.match(contactSql(true), /rollback;/);
  assert.match(contactSql(false), /commit;/);
});
test("rehearsal and apply submit once after journaling and verify complete source preservation", async () => {
  for (const rehearse of [true, false]) {
    const m = mock({ rehearse });
    const r = await releaseContacts({ ...args, ...m, rehearse, rehearsal: rehearsal() });
    assert.equal(m.writes, 1);
    assert.equal(r.preExistingSourcesPreserved, true);
    assert.equal(
      r.state,
      rehearse ? "rehearsed_and_rolled_back" : "installed_needs_authenticated_acceptance",
    );
  }
});
test("lost apply acknowledgement is inspected read-only and never resubmitted", async () => {
  const m = mock({ lost: true }),
    r = await releaseContacts({ ...args, ...m, rehearse: false, rehearsal: rehearsal() });
  assert.equal(m.writes, 1);
  assert.equal(r.acknowledged, false);
  assert.equal(r.state, "requires_inspection");
  const c = await confirmContacts({ ...args, fetcher: m.fetcher, journal: m.journal });
  assert.equal(c.report.state, "installed_needs_authenticated_acceptance");
  assert.equal(m.writes, 1);
});
test("source changes and unavailable post-write inspection remain unresolved", async () => {
  for (const opts of [{ tamper: true }, { afterUnavailable: true }]) {
    const m = mock(opts),
      r = await releaseContacts({ ...args, ...m, rehearse: false, rehearsal: rehearsal() });
    assert.equal(m.writes, 1);
    assert.equal(r.state, "requires_inspection");
    assert.equal(r.preExistingSourcesPreserved, false);
  }
});
test("wrong target, stale rehearsal and journal failure prevent any submission", async () => {
  for (const extra of [
    { allowProjectRef: "production" },
    { rehearsal: { ...rehearsal(), observedAt: "2000-01-01Z" } },
    {
      persistJournal: async () => {
        throw Error("disk full");
      },
    },
  ]) {
    const m = mock();
    await assert.rejects(
      releaseContacts({ ...args, ...m, rehearse: false, rehearsal: rehearsal(), ...extra }),
    );
    assert.equal(m.writes, 0);
  }
});
