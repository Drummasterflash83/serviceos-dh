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
  CONTACT_RELEASE,
  CONTACT_SHA,
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
function contactFixture(installed = false) {
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
import { RESUME_FUNCTION_QUERY } from "./learn-commusoft-resume-catalog.mjs";
import {
  resumePrior,
  resumeExpected,
  resumePrerequisites,
  RESUME_RELEASE,
  RESUME_SHA,
} from "./learn-test-commusoft-resume-release.mjs";
function resumeFixture(installed = false) {
  const c = contactFixture(true);
  c.resumeFunctions = structuredClone(resumePrior().functions);
  assert.equal(resumePrerequisites(c), true);
  if (installed) {
    const e = resumeExpected();
    c.resumeFunctions.push(...e.functions);
    c.resumeFunctions.sort((a, b) => a.name.localeCompare(b.name));
    c.base.inventory.functions.push(...e.functions.map(compact));
    c.base.inventory.functions.sort((a, b) => a.name.localeCompare(b.name));
    const r = {
      migration_name: RESUME_RELEASE,
      source_sha256: RESUME_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T14:00:00Z",
    };
    c.readiness.customMigrationEntries.push(r);
    if (c.base.report.customMigrationEntries !== c.readiness.customMigrationEntries)
      c.base.report.customMigrationEntries.push(r);
  }
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}
import {
  CAPTURE_FUNCTION_QUERY,
  CAPTURE_GRANTS_QUERY,
  CAPTURE_FUNCTIONS,
} from "./learn-capture-health-catalog.mjs";
import {
  capturePrior,
  captureExpected,
  capturePrerequisites,
  installedCapture,
  withoutCapture,
  captureFingerprint,
  captureSql,
  releaseCapture,
  confirmCapture,
  CAPTURE_RELEASE,
  CAPTURE_SHA,
  CAPTURE_PRESERVED_TABLES,
  CAPTURE_SNAPSHOT_QUERY,
} from "./learn-test-capture-health-release.mjs";
function captureFixture(installed = false) {
  const c = resumeFixture(true),
    p = capturePrior();
  c.captureFunctions = structuredClone(p.functions);
  c.captureGrants = structuredClone(p.grants);
  c.tables = c.tables.map((t) => p.tables.find((x) => x.name === t.name) ?? t);
  assert.equal(capturePrerequisites(c), true);
  if (installed) {
    const e = captureExpected();
    c.captureFunctions.push(...e.functions);
    c.captureFunctions.sort((a, b) => a.name.localeCompare(b.name));
    c.base.inventory.functions.push(...e.functions.map(compact));
    c.base.inventory.functions.sort((a, b) => a.name.localeCompare(b.name));
    const r = {
      migration_name: CAPTURE_RELEASE,
      source_sha256: CAPTURE_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T14:00:00Z",
    };
    c.readiness.customMigrationEntries.push(r);
    if (c.base.report.customMigrationEntries !== c.readiness.customMigrationEntries)
      c.base.report.customMigrationEntries.push(r);
  }
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}

import {
  EMAIL_HEALTH_FUNCTION_QUERY,
  EMAIL_HEALTH_GRANTS_QUERY,
} from "./learn-email-health-catalog.mjs";
import {
  emailHealthPrior,
  emailHealthExpected,
  emailHealthPrerequisites,
  installedEmailHealth,
  withoutEmailHealth,
  emailHealthFingerprint,
  emailHealthSql,
  releaseEmailHealth,
  confirmEmailHealth,
  EMAIL_HEALTH_RELEASE,
  EMAIL_HEALTH_SHA,
  EMAIL_HEALTH_PRESERVED_TABLES,
  EMAIL_HEALTH_SNAPSHOT_QUERY,
} from "./learn-test-email-health-release.mjs";
function fixture(installed = false) {
  const c = captureFixture(true),
    p = emailHealthPrior();
  c.emailHealthFunctions = structuredClone(p.functions);
  c.emailHealthGrants = structuredClone(p.grants);
  c.tables = c.tables.map((t) => p.tables.find((x) => x.name === t.name) ?? t);
  assert.equal(emailHealthPrerequisites(c), true);
  if (installed) {
    const e = emailHealthExpected();
    for (const key of ["emailHealthFunctions", "captureFunctions"])
      c[key] = c[key].map((f) => e.functions.find((x) => x.name === f.name) ?? f);
    c.tables = c.tables.map((t) => e.tables.find((x) => x.name === t.name) ?? t);
    c.base.inventory.functions = c.base.inventory.functions.map((f) =>
      e.functions.some((x) => x.name === f.name)
        ? compact(e.functions.find((x) => x.name === f.name))
        : f,
    );
    const r = {
      migration_name: EMAIL_HEALTH_RELEASE,
      source_sha256: EMAIL_HEALTH_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T14:00:00Z",
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
    EMAIL_HEALTH_PRESERVED_TABLES.map((name, i) => ({
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
        return Response.json([{ marker: "learn-test-email-health/1", receipt_expected: true }]);
      }
      if (writes && afterUnavailable) throw Error("Metadata temporarily unavailable");
      if (q === EMAIL_HEALTH_FUNCTION_QUERY)
        return Response.json([{ functions: current().emailHealthFunctions }]);
      if (q === EMAIL_HEALTH_GRANTS_QUERY)
        return Response.json([{ grants: current().emailHealthGrants }]);
      if (q === CAPTURE_FUNCTION_QUERY)
        return Response.json([{ functions: current().captureFunctions }]);
      if (q === CAPTURE_GRANTS_QUERY) return Response.json([{ grants: current().captureGrants }]);
      if (q === RESUME_FUNCTION_QUERY)
        return Response.json([{ functions: current().resumeFunctions }]);
      if (q === CONTACT_FUNCTION_QUERY)
        return Response.json([{ functions: current().contactFunctions }]);
      if (q === CONTACT_GRANTS_QUERY) return Response.json([{ grants: current().contactGrants }]);
      if (q === EMAIL_HEALTH_SNAPSHOT_QUERY) return Response.json(sources());
      return base.fetcher(url, o);
    },
  };
}
const rehearsal = () => ({
  version: "learn-test-email-health/1",
  projectRef: TEST_PROJECT,
  sourceSha256: EMAIL_HEALTH_SHA,
  state: "rehearsed_and_rolled_back",
  acknowledged: true,
  preExistingSourcesPreserved: true,
  beforeFingerprint: emailHealthFingerprint(fixture()),
  afterFingerprint: emailHealthFingerprint(fixture()),
  observedAt: new Date().toISOString(),
});
test("email health release pins the changed reader/index and preserves guards, permissions and both ledgers", () => {
  const before = fixture(),
    after = fixture(true);
  assert.equal(installedEmailHealth(after), true);
  assert.equal(emailHealthFingerprint(withoutEmailHealth(after)), emailHealthFingerprint(before));
  for (const mutate of [
    (c) =>
      (c.emailHealthFunctions.find((f) => f.name === "email_ingestion_run_guard_v2").definition +=
        " "),
    (c) => c.tables.find((t) => t.name === "email_sync_runs").indexes.pop(),
    (c) =>
      c.emailHealthGrants.push({
        table: "email_sync_runs",
        role: "anon",
        column: null,
        privilege: "SELECT",
        grantable: false,
      }),
    (c) => (c.captureFunctions.find((f) => CAPTURE_FUNCTIONS.includes(f.name)).anonExecute = true),
    (c) => (c.captureFunctions.find((f) => CAPTURE_FUNCTIONS.includes(f.name)).definition += " "),
    (c) =>
      (c.base.report.customMigrationEntries = c.base.report.customMigrationEntries.slice(0, -1)),
    (c) =>
      (c.contactFunctions.find((f) => f.name === "learn_commusoft_confirm_contact").anonExecute =
        true),
    (c) =>
      (c.commusoftFunctions.find((f) => f.name === CONTACT_CHANGED_FUNCTIONS[0]).definition += " "),
    (c) => (c.tables.find((t) => t.name === "email_accounts").rls = false),
    (c) =>
      c.captureGrants.push({
        table: "email_accounts",
        column: null,
        role: "anon",
        privilege: "SELECT",
        grantable: false,
      }),
    (c) => (c.base.functions.find((f) => f.slug === "learn-commusoft-verify").verify_jwt = false),
  ]) {
    const c = fixture(true);
    mutate(c);
    assert.equal(installedEmailHealth(c), false);
  }
  assert.match(emailHealthSql(true), /rollback;/);
  assert.match(emailHealthSql(false), /commit;/);
});
test("rehearsal and apply submit once after journaling and verify complete source preservation", async () => {
  for (const rehearse of [true, false]) {
    const m = mock({ rehearse });
    const r = await releaseEmailHealth({ ...args, ...m, rehearse, rehearsal: rehearsal() });
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
    r = await releaseEmailHealth({ ...args, ...m, rehearse: false, rehearsal: rehearsal() });
  assert.equal(m.writes, 1);
  assert.equal(r.acknowledged, false);
  assert.equal(r.state, "requires_inspection");
  const c = await confirmEmailHealth({ ...args, fetcher: m.fetcher, journal: m.journal });
  assert.equal(c.report.state, "installed_needs_authenticated_acceptance");
  assert.equal(m.writes, 1);
});
test("source changes and unavailable post-write inspection remain unresolved", async () => {
  for (const opts of [{ tamper: true }, { afterUnavailable: true }]) {
    const m = mock(opts),
      r = await releaseEmailHealth({ ...args, ...m, rehearse: false, rehearsal: rehearsal() });
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
      releaseEmailHealth({ ...args, ...m, rehearse: false, rehearsal: rehearsal(), ...extra }),
    );
    assert.equal(m.writes, 0);
  }
});
