/** Optional 5,000-site / 5,000-job real-Auth trial, inside the existing isolated fixture. */
const check = (v, s) => {
  if (!v) throw Error(s);
};
export async function exerciseLargeImportGraph({
  expect,
  session,
  previewBody,
  apply,
  sql,
  q,
  tenant,
  plan,
  save,
  counts,
  checks,
}) {
  const before = await counts(),
    large = { rows: 5000, phase: "prepared", timings: [] };
  plan.largeGraph = large;
  save();
  const call = async (label, body) => {
    large.phase = label;
    save();
    console.error(label);
    const start = Date.now(),
      r = await expect(session, body, 200);
    large.timings.push({ phase: label, ms: Date.now() - start });
    save();
    return r;
  };
  const preview = async (entity, csv, label) => {
    const before = await counts(),
      r = await call(label, previewBody(entity, csv));
    plan.imports.push(r.import_id);
    save();
    check(
      JSON.stringify(await counts()) === JSON.stringify(before),
      "Large preview changed canonical records",
    );
    return r;
  };
  const siteCsv =
    "source_system,external_id,customer_external_id,label,address_text,postcode,active\n" +
    Array.from(
      { length: 5000 },
      (_, i) =>
        `commusoft,LARGE-S${i + 1},C1,SYNTHETIC Large Site ${i + 1},${i + 1} Synthetic Avenue,SW1A 1AA,true`,
    ).join("\n");
  const sites = await preview("sites", siteCsv, "large_sites_preview");
  check(
    sites.preview?.will_create === 5000 && sites.preview?.invalid === 0,
    "Large site preview totals differ",
  );
  large.siteImport = sites.import_id;
  save();
  const siteApply = await call("large_sites_apply", apply(sites.import_id, siteCsv));
  check(
    siteApply.status === "completed" && siteApply.created === 5000 && siteApply.unprocessed === 0,
    "Large site apply incomplete",
  );
  const jobHeader =
    "source_system,external_id,job_number,customer_external_id,site_external_id,title,status,active\n";
  const jobCsv =
    jobHeader +
    Array.from({ length: 5000 }, (_, i) => {
      const mode = i % 1000,
        external = mode === 0 ? "" : `LARGE-J${i + 1}`,
        customer = mode === 1 ? "LARGE-MISSING" : mode === 2 ? "C2" : "C1",
        site = mode === 1 ? "LARGE-WAITING" : `LARGE-S${i + 1}`;
      return `commusoft,${external},${800001 + i},${customer},${site},SYNTHETIC Large Job ${i + 1},open,true`;
    }).join("\n");
  const jobs = await preview("jobs", jobCsv, "large_mixed_jobs_preview");
  large.jobImport = jobs.import_id;
  save();
  check(
    jobs.preview?.row_count === 5000 &&
      jobs.preview?.will_create === 4985 &&
      jobs.preview?.invalid === 5 &&
      jobs.preview?.will_hold === 5 &&
      jobs.preview?.will_conflict === 5,
    "Large mixed job preview totals differ",
  );
  const initial = await call("large_mixed_jobs_apply", apply(jobs.import_id, jobCsv));
  large.initialTotals = {
    status: initial.status,
    created: initial.created,
    held: initial.held,
    conflicts: initial.conflicts,
    invalid: initial.invalid,
    unprocessed: initial.unprocessed,
  };
  save();
  check(
    initial.status === "needs_review" &&
      initial.created === 4985 &&
      initial.held === 5 &&
      initial.conflicts === 5 &&
      initial.invalid === 5 &&
      initial.unprocessed === 0,
    "Mixed job outcomes were lost or misreported",
  );
  async function ledger(expectedHeld) {
    const found = [];
    let after = 1;
    for (let n = 0; n < 25; n++) {
      const page = await expect(
        session,
        { action: "row_results", import_id: jobs.import_id, after_row: after, page_size: 200 },
        200,
      );
      check(
        page.tenant_id === tenant &&
          page.import_id === jobs.import_id &&
          page.after_row === after &&
          page.page_size === 200 &&
          page.rows.length === 200,
        "Large job page differs",
      );
      found.push(...page.rows);
      if (n === 24)
        check(
          page.next_after_row === null && !page.truncated,
          "Large job ledger did not terminate",
        );
      else
        check(
          page.truncated && page.next_after_row === page.rows.at(-1).row_number,
          "Large job continuation differs",
        );
      after = page.next_after_row;
    }
    check(
      found.length === 5000 &&
        found.every((r, i) => {
          const mode = i % 1000,
            outcome =
              mode === 0
                ? "invalid"
                : mode === 1 && expectedHeld
                  ? "held"
                  : mode === 2
                    ? "conflict"
                    : "created",
            attempt = mode === 1 && !expectedHeld ? 2 : 1;
          return r.row_number === i + 2 && r.outcome === outcome && r.attempt === attempt;
        }),
      "Large mixed row sequence, outcome or attempt differs",
    );
    return { rows: 5000, pages: 25, sequenceAndAttempts: true };
  }
  large.initialLedger = await ledger(true);
  save();
  async function terminalFingerprint() {
    return (
      await sql(
        `select count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from import_row_results s where tenant_id=${q(tenant)} and import_id=${q(jobs.import_id)} and (row_number-2)%1000<>1`,
        true,
      )
    )[0];
  }
  large.terminalBefore = await terminalFingerprint();
  check(large.terminalBefore.count === 4995, "Terminal row set differs");
  save();
  const customerCsv =
    "source_system,external_id,record_kind,display_name,active\ncommusoft,LARGE-MISSING,person,SYNTHETIC Waiting Customer,true";
  const waitingSiteCsv =
    "source_system,external_id,customer_external_id,label,address_text,postcode,active\ncommusoft,LARGE-WAITING,LARGE-MISSING,SYNTHETIC Waiting Site,1 Waiting Avenue,SW1A 1AA,true";
  for (const [entity, csv] of [
    ["customers", customerCsv],
    ["sites", waitingSiteCsv],
  ]) {
    const p = await preview(entity, csv, "large_dependency_" + entity + "_preview");
    check(p.preview?.will_create === 1, "Large dependency preview differs");
    const a = await call("large_dependency_" + entity + "_apply", apply(p.import_id, csv));
    check(a.status === "completed" && a.created === 1, "Large dependency import did not complete");
  }
  const resumed = await call("large_mixed_jobs_continue", apply(jobs.import_id, jobCsv));
  large.resumedTotals = {
    status: resumed.status,
    created: resumed.created,
    held: resumed.held,
    conflicts: resumed.conflicts,
    invalid: resumed.invalid,
    unprocessed: resumed.unprocessed,
  };
  save();
  check(
    resumed.status === "needs_review" &&
      resumed.created === 4990 &&
      resumed.held === 0 &&
      resumed.conflicts === 5 &&
      resumed.invalid === 5 &&
      resumed.unprocessed === 0,
    "Mixed retry did not retain terminal rows and recover held rows",
  );
  large.finalLedger = await ledger(false);
  large.terminalAfter = await terminalFingerprint();
  check(
    JSON.stringify(large.terminalBefore) === JSON.stringify(large.terminalAfter),
    "Retry changed a previously terminal outcome",
  );
  const integrity = (
    await sql(
      `select
 (select count(*)::int from sites s join import_entity_links l on l.tenant_id=s.tenant_id and l.entity_table='sites' and l.entity_id=s.id where s.tenant_id=${q(tenant)} and l.external_id like 'LARGE-S%') as large_sites,
 (select count(*)::int from jobs j join import_entity_links l on l.tenant_id=j.tenant_id and l.entity_table='jobs' and l.entity_id=j.id where j.tenant_id=${q(tenant)} and l.external_id like 'LARGE-J%') as large_jobs,
 (select count(*)::int from import_row_provenance where tenant_id=${q(tenant)} and import_id=${q(jobs.import_id)}) as job_provenance,
 (select count(*)::int from import_conflicts where tenant_id=${q(tenant)} and import_id=${q(jobs.import_id)}) as job_conflicts,
 (select count(*)::int from import_row_results r join jobs j on j.tenant_id=r.tenant_id and j.id=r.entity_id left join sites s on s.tenant_id=j.tenant_id and s.id=j.site_id where r.tenant_id=${q(tenant)} and r.import_id=${q(jobs.import_id)} and r.outcome='created' and (j.customer_person_id is null or s.id is null or j.customer_person_id is distinct from s.person_id)) as broken_job_sites`,
      true,
    )
  )[0];
  check(
    integrity.large_sites === 5000 &&
      integrity.large_jobs === 4990 &&
      integrity.job_provenance === 4990 &&
      integrity.job_conflicts === 5 &&
      integrity.broken_job_sites === 0,
    "Large graph relationships/provenance differ",
  );
  large.integrity = integrity;
  large.counts = await counts();
  check(
    large.counts.people === before.people + 1 &&
      large.counts.sites === before.sites + 5001 &&
      large.counts.jobs === before.jobs + 4990,
    "Large graph canonical counts differ",
  );
  save();
  const replay = await call("large_mixed_jobs_replay", apply(jobs.import_id, jobCsv));
  check(
    replay.status === "needs_review" &&
      replay.created === 4990 &&
      replay.conflicts === 5 &&
      replay.invalid === 5 &&
      JSON.stringify(await counts()) === JSON.stringify(large.counts) &&
      JSON.stringify(await terminalFingerprint()) === JSON.stringify(large.terminalBefore),
    "Mixed review replay changed terminal evidence/counts",
  );
  large.phase = "passed";
  save();
  checks.push(
    "Actual 5,000-site import and 5,000-job mixed import preserve invalid/conflict outcomes, hold unresolved dependencies, recover exactly five held rows at attempt 2, retain 4,995 terminal rows unchanged and keep every created job linked to its owning site/customer.",
  );
}
