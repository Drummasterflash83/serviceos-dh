/** Direct, user-authorized provider acceptance: at most eight GETs.
 * Properties: two pages of at most 100; jobs/contacts: two pages of one each.
 * No hosted authority, credential binding, database writes or provider mutations.
 * Source records and cursors stay in memory; reports contain aggregate checks only.
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  readCommusoftPage,
  CommusoftReadError,
} from "../../supabase/functions/_shared/commusoft/read_page.ts";
import { commusoftSourceRecords } from "../../supabase/functions/_shared/commusoft/source_records.ts";
import { responseFormat } from "./learn-commusoft-live-read.mjs";

const collections = [
  { resource: "properties" },
  { resource: "jobs" },
  { resource: "propertyContacts", contactType: "customer" },
  { resource: "propertyContacts", contactType: "workaddress" },
];

export async function inspectCoverage(apiKey, { fetcher = fetch, persist, clock = Date.now } = {}) {
  if (typeof persist !== "function") throw Error("Durable diagnostic journal required");
  const report = {
    version: "commusoft-bounded-coverage/2",
    startedAt: new Date(clock()).toISOString(),
    state: "started",
    checks: [],
    providerRequests: 0,
    providerMutations: 0,
    databaseMutations: 0,
    limits: [
      "At most two 100-record property pages, two one-record job pages and two one-record contact pages per observed property type. No full traversal or account-wide completeness claim.",
      "Direct local provider reads only. No hosted binding, import, schedule, canonical publication or signed-in acceptance.",
      "No source records, source IDs, cursors or credentials retained. Candidate mapping alone does not prove canonical relationships.",
    ],
  };
  await persist(structuredClone(report));
  const targets = new Map();
  for (const collection of collections) {
    const propertyId =
      collection.resource === "propertyContacts" ? targets.get(collection.contactType) : undefined;
    if (collection.resource === "propertyContacts" && propertyId === undefined) {
      report.checks.push({
        ...collection,
        state: "not_sampled",
        reason: "no_parent_in_bounded_property_sample",
      });
      await persist(structuredClone(report));
      continue;
    }
    const limit = collection.resource === "properties" ? 100 : 1;
    let after = null;
    for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
      const check = {
        ...collection,
        page: pageIndex + 1,
        limit,
        parentBound: propertyId !== undefined,
        usesReturnedCursor: after !== null,
        state: "sending",
        startedAt: new Date(clock()).toISOString(),
        status: null,
      };
      report.checks.push(check);
      // Write intent before traffic. Failed persistence prevents this request.
      await persist(structuredClone(report));
      try {
        const page = await readCommusoftPage(
          {
            region: "uk",
            ...collection,
            limit,
            after,
            ...(propertyId !== undefined ? { propertyId } : {}),
          },
          apiKey,
          {
            stillAuthorized: async () => true,
            clock,
            fetcher: async (url, options) => {
              report.providerRequests++;
              const response = await fetcher(url, options);
              check.status = response.status;
              check.responseFormat = responseFormat(response.headers);
              return response;
            },
          },
        );
        if (collection.resource === "properties") {
          for (const row of page.records)
            if (["customer", "workaddress"].includes(row.type) && !targets.has(row.type))
              targets.set(row.type, row.id);
        }
        const candidates = commusoftSourceRecords(page, {
          tenantId: "00000000-0000-0000-0000-000000000001",
          connectionId: "99999999-9999-4999-8999-999999999999", // diagnostic only
          resource: collection.resource,
          observedAt: new Date(clock()).toISOString(),
        });
        check.state = "passed";
        check.records = page.records.length;
        check.hasMore = !page.collectionExhausted;
        check.projections = candidates.map(({ projection: p }) => ({
          state: p.state,
          kind: p.kind ?? null,
          reason: p.reason ?? null,
          referenceCount: p.references?.length ?? 0,
        }));
        check.quota = page.quota;
        if (page.quota.retryAt !== null) {
          report.state = "quota_wait";
          await persist(structuredClone(report));
          return report;
        }
        await persist(structuredClone(report));
        if (page.collectionExhausted) break;
        after = page.nextCursor;
      } catch (error) {
        check.state = "failed";
        check.code = error instanceof CommusoftReadError ? error.code : "diagnostic_unconfirmed";
        check.retryAt = error instanceof CommusoftReadError ? error.retryAt : null;
        report.state = "not_verified";
        await persist(structuredClone(report));
        return report;
      }
    }
  }
  report.state = report.checks.every((c) => c.state === "passed")
    ? "bounded_reads_verified"
    : "sample_incomplete";
  report.completedAt = new Date(clock()).toISOString();
  await persist(structuredClone(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") !== "--existing-local-key") throw Error();
    const root = new URL("../../.verification-results/", import.meta.url);
    const keyFile = new URL("commusoft-existing-private-key", root);
    const metadata = await stat(keyFile);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.size > 4096) throw Error();
    const key = (await readFile(keyFile, "utf8")).trim();
    const journal = new URL("commusoft-bounded-coverage-scoped.json", root);
    let first = true;
    const report = await inspectCoverage(key, {
      persist: async (value) => {
        await writeFile(journal, JSON.stringify(value, null, 2) + "\n", {
          mode: 0o600,
          flag: first ? "wx" : "w",
        });
        first = false;
      },
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.state !== "bounded_reads_verified") process.exitCode = 1;
  } catch {
    console.error(
      "Coverage check unconfirmed; inspect the private journal before any further request.",
    );
    process.exitCode = 1;
  }
}
