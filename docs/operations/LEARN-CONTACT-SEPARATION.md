# Reviewed shared contact details

Status: released and verified in TEST and LIVE on 14 October 2026. The exact
backend package and isolated three-file frontend are installed; existing branding,
provider capture and account access remain intact.

## User journey

When a named Commusoft contact shares a number or email with someone already
saved, the default import continues to hold the possible match. The operator can
load every default candidate (up to fifty), choose **Create a separate named
person after review**, record evidence of the different name/role and shared
contact details, and confirm the review. Household, department and business
labels still require a different resolution; this option is for named people.

The server checks the exact retained source version/name and the complete current
candidate ID set again. It uses the normal contact writer to retain the customer,
site, card and source relationships. Original people are unchanged. The new
person's primary fields remain unset; imported contact points stay non-primary
and unverified. Source consent flags do not become marketing permissions.

A failed source/endpoint check leaves no orphan person. The immutable projection
receipt retains the separation evidence and actor. A lost response is recovered
from the existing durable batch receipt without issuing another write. Browser
drafts containing this review use version two; older clients refuse them rather
than dropping the identity decision.

## Communication attribution

Automatic identity delivery now checks for multiple people sharing a retained
contact endpoint, including a primary-only counterpart. Source-backed phone
normalization uses that connection's region; email matching trims and lowercases.
It returns the existing `person_ambiguous` review state before attaching a card.
A single unverified contact point is not promoted into a confirmed identity.

An authorised operator can still resolve a particular held communication through
the existing logged identity review. This does not verify the person globally or
make the shared endpoint primary. The change does not retroactively reassign old
communications. Concurrent attribution and contact publication still require
rollout observation; the rehearsals are not a load/concurrency certification.

## Evidence

- Twelve browser-outbox/library tests, TypeScript and the Vercel-mode build pass.
- Offline native archive plus twenty-four reviewed packages: the original contact
  suite, the new separation/delivery journeys and existing identity-delivery and
  operator-review regressions pass. All 394 checked tables, 1,591,580 archived rows
  and seven sequences are preserved. The isolated container has no network,
  host mounts or exposed ports and was removed. This covers archived COPY data,
  not every omitted source object or later unrelated production migration.
- Hosted TEST's actual current backend passes the separation and identity journeys
  in a rolled-back synthetic transaction. It uses explicit fixture-only grants
  and the current existing-target customer path. Before/after function definitions,
  user access, retained business versions/links, people and contact points match.
- Exact guarded installation and explicit SQL reversal pass in a TEST rollback
  transaction. Reversal after a synthetic separate contact exists is refused.
- Signed-in TEST first held the default shared-number import, required new evidence
  and renewed approval, then published the distinct synthetic contact. Its original
  customer card shows two unverified saved details and unchanged primary choices.
- Signed-in LIVE published one reviewed real contact to its original customer and
  site; both distinct people are visible on the customer card. Exact source, actor,
  graph relationships and append-only review receipts pass readback. All fifty-two
  prior contact links remain; the total is fifty-three.
- Before/after installation preserved 18,079 business source-version hashes, 794
  source links, 3,302 people and 93 contact points, plus account access. These are
  scoped release comparisons, not a whole-production snapshot claim.
- Provider capture remains active. A post-release identity sample has eleven settled
  batches, one committed match and a queued continuation with no unexpected error
  code; review holds remain separate from successful attribution.
- No provider request or new credential/account/grant was created by this release.

[Release manifest](../../supabase/release/learn-contact-separation/manifest.json)
contains exact source, installation, reversal and accepted function fingerprints.
Local reproduction:

```sh
python3 scripts/backup/rehearse_contact_separation.py --output /private/tmp/serviceos-contact-separation-new-rehearsal
node --test src/lib/learn-commusoft-work.test.ts
npx tsc --noEmit
VERCEL=1 npm run build
```

## Rollout and rollback

The following sequence has been completed for this release. Retain it for later
changes; repeat checks against their actual current baselines.

1. Recheck the exact function definitions, owners/grants, existing records and
   provider state. Install the guarded package in TEST with the explicit project
   setting. The newly created helpers have no API-role execution grants.
2. Deploy the reviewed frontend change to stable TEST and verify signed-in source
   review, evidence entry, saved receipt/recovery and resulting card. Keep the
   existing TEST-only job-refresh controls out of the isolated LIVE frontend diff.
3. Install and verify the same backend in LIVE, then promote that isolated frontend
   with existing branding and domain protections. Verify actual shared-office
   contacts through logged OpenFolk controls, preserving their source/customer/site
   evidence. Observe attribution processing after publication.
4. Record exact releases, real acceptance and before/after preservation. Further
   ambiguous/group contacts and overall customer/job coverage remain open.

Prefer reverting the frontend while retaining this compatible backend. Do not
clear pending browser drafts; recover or cancel their exact requests using a
compatible client first. The old client cannot operate a version-two draft.

The SQL reversal restores the prior batch and delivery functions and removes only
the two new helpers. It refuses to run once a separated contact has been published:
removing the ambiguity guard at that point could misattribute the shared endpoint.
After publication, retain the backend and prepare a forward correction. Neither
rollback path deletes people, source history, review receipts or contact points.

## Released frontends

LIVE `5375262266445fc9d913b96242d4c7a51387d0d4` /
`dpl_AuCREnJ5GQNVN8YodUAYhNsnvqcB` is verified on all four existing aliases.
LIVE frontend rollback is `c45c95a6188555d470f7c22146128be23471b531` /
`dpl_DwKyTb8sUSWhcqgXQuJm1Uej5hDS`.

TEST `778f7ad828086888ba4d355319a4a538725e3eff` /
`dpl_DpvxmPfubUNPbTbUnpHgasNwD5BP` is verified on both stable TEST aliases.
TEST frontend rollback is `8f99829de7de78fcc3d47b9e75884ad0dced02fe` /
`dpl_GxKWS5zVMVEuogKuMXs8HTGNqkoz`. Existing deployment protections are unchanged.
TEST retains its earlier job-refresh controls; LIVE does not gain them.

SQL reversal now intentionally refuses in both environments because separate
contacts have been published. Keep the compatible backend with a frontend rollback.
The synthetic TEST evidence is clearly labelled and has no provider credential,
input account, schedule, processing job, new login or grant.

[Sanitised acceptance evidence](evidence/learn-contact-separation-live-2026-10-14.json).
