# Additive customer contact details reader

Prepared exact TEST/production envelopes for the read-only contact-details UI.
Consult the completion checklist and release evidence for installation status.
Never apply the other environment's file or run the migration directory wholesale.

The envelope requires a postgres executor, `serviceos.release_target` equal to its
exact project ref, and `serviceos.release_sha256` equal to the manifest source hash.
It rejects an existing installation and drift in the three reviewed reader/authority
functions, including owner/ACL. In one repeatable-read transaction it verifies that
canonical people/companies/cards/contact points/graph/source links/connections and
operator grants, table protections, role memberships, policies, schedules and every
unrelated public function remain unchanged. It then reloads the API schema cache.

Both envelopes passed wrong-target, wrong-digest, dependency-drift, late-failure and
rollback rehearsals against the retained native archive plus 24 release packages.
The new reader and existing business reader passed their actual access and paging
journeys. All 1,591,580 archived rows and seven sequences remain identical. This
baseline excludes later unrelated changes; live dependency/preservation readback is
required before and after applying. No synthetic fixture belongs in a hosted run.

Publish the backend before the matching frontend. The previous frontend does not
use this new function, so it remains compatible. For a frontend regression, restore
the prior verified Vercel deployment and keep the unused reader; do not rewrite
people, primary choices, verification, contact preferences or retained sources.

Reproduce the candidate's isolated database checks with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/backup/rehearse_customer_contact_points.py \
  --output /private/tmp/new-contact-details-rehearsal
```

After installation, use an existing signed-in authorised customer or logged
OpenFolk operator, select a customer and contact, then open **View saved contact
details**. Verify real saved non-primary endpoints, accurate verification status,
and an operator audit where applicable. Anonymous/service-role execution is denied.
Ordinary clients must remain limited to the same customer/contact scope as the
existing business-context reader. No additional person grants are required.
