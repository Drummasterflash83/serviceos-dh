# M1 whole-roster first-hold verifier

Run `node scripts/verify/new-dawn-m1-roster-first-hold.mjs` with the existing
noninteractive Supabase CLI login. It makes one SQL request to the management
API's **read-only** endpoint and returns aggregate counts only. It requires one
configured Commusoft connection for the Drummonds tenant and fails if its
first-hold classes do not sum to the entire unlinked saved-job roster.

The query chooses the latest **committed page observation** for each source ID
within its original tenant, connection and collection. Multiple source versions
at the same latest committed time are ambiguous and held. It counts job IDs
without current canonical links; it does not fetch Commusoft, return provider
payloads or row identifiers, create a site/job/link, or invoke an apply RPC.

The classes are mutually exclusive first holds, evaluated in this order:

| Class | Meaning |
| --- | --- |
| `job_source_hold` | Job source/latest identity or numeric property reference is missing, ambiguous or invalid. |
| `property_source_hold` | Referenced property source/latest identity or property kind is missing, ambiguous or invalid. |
| `customer_property_outside_dual_id` | Valid customer-property job. This is a supported Commusoft shape, but Chris's narrower customer-**and**-site dual-ID link rule cannot assign a site from it. |
| `customer_identity_unreviewed` | Workaddress parent source, customer kind, current source link or customer-card target has not been proved. |
| `postcode_collision` | A workaddress with a reviewed parent shares a normalized postcode with a canonical site and is held for duplicate review. |
| `site_mapping_review` | A current property link already exists; its exact job-link candidacy is not asserted by this aggregate query. |
| `site_source_other_hold` | Workaddress lacks a usable address line or postcode. |
| `provisional_site_review` | Saved workaddress and reviewed parent pass these aggregate prerequisites with no postcode collision or existing site link. The private transactional site candidate, other identity/field conflicts, source-version lock and rollback rehearsal remain unproved. |

The per-class distinct-property numbers are **not additive**: one source
property can appear in jobs whose earlier first hold differs. A provisional
job is never labelled clean or approved by this verifier. The output always
sets `clean_exact_batch_proven=false` and records that it applied zero links.
The internal exact-site candidate function is deliberately not granted to the
read-only SQL role; this tool leaves that security boundary unchanged.

Check the current timestamped result in a private receipt before acting. The
synthetic two-tenant fixture is
`python3 scripts/verify/new-dawn-m1-roster-first-hold-local.py`; the wrapper
contract tests are
`node --test scripts/verify/new-dawn-m1-roster-first-hold.test.mjs`.
