# M2 unsupported job facets — private, held review

The existing M2 job record has saved Commusoft job facts and quote **text**.
An exact-job read can return source user IDs and expected times when its
separate flag is enabled, but neither identifies an OpenFolk engineer or a
visit. The `/users` source collection is also a separate opt-in, held from
staff projection. The reviewed Commusoft v2 API navigation has no confirmed
job-linked technician appointment, estimate, invoice or parts/cost read.
`/scheduledActivities` is an office-task collection, not a visit feed;
`/opportunities` is not proof of an accepted quote or invoice. The historical
Drummonds diary exports lack event-level IDs, zoned start/end times and proof
that their record numbers equal current v2 job IDs. See
`NEW-DAWN-M2-JOB-RECORD.md` and `NEW-DAWN-M2-VISIT-SOURCE-BOUNDARY.md` for
the source audit and exact export requirements.

`scripts/commusoft/review-job-facet-csv.mjs` is an independent **private local**
review of one authorised export using the existing strict CSV preparation
contract. It makes no provider or database request and cannot publish a card.
It supports visits, source engineers, estimates, invoices, and parts/costs.
Every row remains `held`; `ready_for_source_review` means only that the row
has enough syntactic source fields to be checked later. It is never a verified
job link, appointment, person, accepted quote, invoice value, paid amount or
margin. The review lists the exact hold reasons for each source record and
prints only aggregate counts and the input hash. The detailed JSON is created
once with mode `0600` outside Git.

```sh
node scripts/commusoft/review-job-facet-csv.mjs \
  --manifest /private/path/scope.json \
  --csv /private/path/authorised-export.csv \
  --out /private/path/facet-review.json
```

The review keeps the export timestamp separate from row freshness. The CSV
contract has no source row-updated timestamp or completeness assertion, so
the output says `record_updated_at: not_supplied` and
`current_provider_state: unverified`. It does not calculate elapsed visit time,
financial totals or staff assignments. A date without timezone or a visit
whose end does not follow its start stays in `needs_source_fields`. Missing
source job IDs also stay there; job **codes remain strings** and cannot repair
the missing ID. A source engineer ID can be present or absent without being
mapped to an OpenFolk person. Amount, currency and quantity checks are only
syntax checks; their business meaning remains unreviewed.

No real export was imported for this slice. The archived diary files do not
match the strict source CSV header or required event-level identity and remain
held. An owner-provided export must first supply the field dictionary, source
account/connection, coverage window, stable event/document/line IDs and exact
parent v2 job IDs. Only then can an audited same-tenant/connection job-link
review and immutable retention path be designed. The LIVE shared-lease
installation and all associated flags stay separate and off.

Validation: the existing CSV tests and new held-review tests cover all five
facets, timezone/inverted visits, missing job IDs, unverified staff/money,
malformed CSV, private output permissions and no overwrite. TypeScript and
build checks are run with the PR. The tests use synthetic data only.
