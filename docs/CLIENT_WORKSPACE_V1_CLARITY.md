# Client workspace V1 — clarity release

## Scope

Frontend only. No database migrations, provider changes, phone cutover, user invitations,
price publication or new AI-provider requests.

- Workspace is an operational launchpad: receptionist, Programme, Invoices, Feedback.
- Programme contains delivery progress, proposed outcomes and clearly illustrative card concepts.
- Invoices has a dedicated block layout, not the proposal-summary flex layout.
- Client/section URLs survive refresh/back navigation. Explicit inaccessible tenant selections
  fail closed rather than opening the first accessible client's data.
- Operator client/receptionist links and receptionist return links preserve tenant context.
- Default login uses the existing platform-view capability; explicit destinations are retained.
- Receptionist overview exposes launch stage, provider connection freshness, loaded-history
  coverage, assessment coverage, review queue and repeat-number history.
- Review priority uses existing provider end reasons, success/sentiment assessments and explicit
  structured boolean signals. It does not analyse prose by keywords, make new model calls, or
  claim that repeat callers are unresolved chasers. Unsupported/missing assessments remain unknown.
- Call details show the reason and source of each flag, recordings inline with a failure state,
  transcripts and same-number history. A transfer is not labelled a resolved enquiry.
- Programme feedback displays persisted Slack delivery state separately from saving the note.

## Important limits

This is not a newly configured comprehensive Vapi analysis pipeline. Confusion, repeat-question,
follow-up and chasing flags require corresponding provider structured output evidence; absent
fields are not invented. Provider assessment is not measured customer satisfaction. The workspace
launch stage remains its stored value. Historical calls have not been reclassified as test/live.
Calls and caller counts cover loaded records; older history remains explicitly pageable.

## Verification

Local result: 54 focused tests passed, TypeScript zero errors, targeted ESLint zero errors,
production build passed. These are code/build proofs, not authenticated browser or audio proofs.

Focused checks include call evidence semantics, priority order, phone-plan rules, invoice pricing
contracts, login error messages, tenant-safe navigation and operator navigation. Run:

```sh
npx tsc --noEmit
node --experimental-strip-types --test src/lib/receptionist-data.test.ts src/lib/receptionist-review.test.ts src/lib/client-portal.test.ts src/lib/client-workspace-nav.test.ts src/lib/auth-errors.test.ts src/lib/phone-plan.test.ts src/lib/openfolk-workspace-nav.test.ts
npm run build
```

The browser refused access before opening the site because its admin-policy verification was
unavailable. This is not a verified app failure. No alternate control path was used to bypass it.
Production promotion still needs authenticated preview smoke testing under docs/DEPLOYMENT.md.

## Remaining release checks

1. Sign in as an operator; confirm the default operator destination and explicit client deep link.
2. As an authorised client, open Workspace → Emma → Workspace, Programme, Invoices and Feedback.
3. Check at 390px and desktop widths: no clipped amounts, inaccessible navigation or horizontal
   page overflow. Review actual typography, contrast and hierarchy.
4. Open a real permitted call: summary, evidence flags, transcript, same-number history and inline
   playback; test a missing/expired recording and failed refresh.
5. Confirm empty/unavailable/provider-unassessed states remain honest. Verify older-call paging.
6. Download a permitted invoice. Verify an unrelated account cannot access client records/files.
7. If a labelled test feedback submission is made, verify its saved record and actual Slack
   delivery separately; never infer delivery from a successful save.
8. Review with Chris, then merge the frontend release and verify the deployed commit. No Heidi
   invitation or live phone routing change is part of this release.
