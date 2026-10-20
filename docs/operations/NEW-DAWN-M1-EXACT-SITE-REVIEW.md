# M1 exact workaddress site review

PR #275's exact customer/site job rule is intentionally held for all 11,671
unlinked saved Commusoft job IDs: none had an existing current ServiceOS site
mapping. This slice adds an OpenFolk operator review path for a **saved
Commusoft workaddress** whose current numeric `id` and
`parentPropertyID` resolve to one current, already reviewed customer in
the **same connection**. It does not map by name, postcode or address
similarity, and it does not project customer-property jobs as workaddresses.
Installing the migration creates no site or job.

The repeatable aggregate-only LIVE readback is
`node scripts/verify/new-dawn-m1-exact-site-live-summary.mjs`. At
20 October 2026, 05:29 UTC it found 11,671 unlinked saved jobs spanning 1,885
distinct property IDs. Of these, 722 IDs currently describe workaddresses.
Thirty workaddresses had a current reviewed parent-customer link, no site
link, no exact external site/legacy identity collision and an address line.
Those 30 IDs are referenced by 434 unlinked jobs. **These are upper-bound
prerequisites, not approved projections or eligible job links.** The
transactional classifier may still hold a property for a changed source,
customer card, ownership or legacy customer conflict. The remaining source
jobs stay in the operator review queue; no score or customer identity is
inferred. Run the readback again before any LIVE action because source versions
and counts change.

The operator-only review page
`new_dawn_commusoft_exact_site_review_page` returns at most 100 saved
workaddress IDs per keyset page, each with `ready` or a named review reason,
and writes a scoped operator read audit. A `ready` row is still only a
candidate. `new_dawn_commusoft_exact_site_apply` requires an explicit
source-version ID and reason; it locks the connection and repeats all current
source, parent, customer-card, module, tenant and identity checks. It creates
one unverified canonical site from typed source fields, one immutable property
link, and an append-only rule/source-version/operator audit. It never requests
Commusoft or creates jobs. Operators cannot call the existing tenant-admin
projector by impersonating client staff.

`new_dawn_commusoft_exact_site_toggle` reverses the mapping by an
append-only event, leaving the site and history intact. It refuses reversal
while **any** canonical job uses that site. Restore rechecks the original
source version, parent customer, site ownership and identity conflicts.
Reversing hides the property link from the current-links view, which makes
PR #275's job classifier hold it. A changed source needs explicit review; it
cannot be silently restored.

The rollback-only TEST transaction
`node scripts/verify/new-dawn-m1-exact-site-rollback.mjs` passes: source
version pin, exact collision hold, unmapped parent hold, review page, site
projection/audit, reversal, restoration, dependent-job guard, foreign-actor
denial and byte-equivalent before/after schema state. It leaves no TEST data.
No LIVE migration or site apply is part of this PR. Before any LIVE projection,
review the migration and rerun that test and LIVE aggregate. Then review a
bounded page of candidate IDs and apply one source-version-pinned site at a
time, followed by PR #275's job candidate check. Report actual site and job
link counts, rather than claiming that all 434 are linked.

## M2 scheduled activities boundary

Commusoft's current official [`GET /scheduledActivities` reference](https://developer.commusoft.com/list-scheduled-activities-31575938e0)
provides activity IDs, parent type/ID, status, due/completion times and
assigned user references, but defines these as manager/office tasks.
Its [concept guide](https://developer.commusoft.com/key-concepts-and-relationships-1985291m0)
describes technician appointments as distinct children of jobs or
opportunities. Therefore the already installed bounded, read-only
scheduled-activity probe can validate **office-task** source shape only; its
flag remains OFF and no provider read was made in this slice. It must not
populate an engineer visit, completed visit or staff handoff. An appointment
source still needs an event-level ID, parent job ID, zoned start/end, status
and correction semantics as documented in
`docs/operations/NEW-DAWN-M2-VISIT-SOURCE-BOUNDARY.md`.
