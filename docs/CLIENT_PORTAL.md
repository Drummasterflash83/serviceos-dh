# OpenFolk client portal — 22 September 2026

## Product

The public homepage explains OpenFolk's outcome-led partnership. `/client` is the private commercial programme: objectives, scoped outcomes, optional additions, proposed investment, reviewed system register, shared resources and persistent feedback. The root homepage no longer contains Drummonds-specific pitch material. Existing operational routes remain available.

Commercial packages describe the result, deliverables, baseline, target, dependencies and acceptance criteria. Unknown prices are null and display “To be agreed”; optional packages are excluded from programme subtotals. A partial subtotal is labelled incomplete. No fabricated savings, agreed targets or outcome guarantees are implied. The portal does not accept contracts, take payment, send email, activate integrations or run background processing.

## Access

- `client_portal_access` grants a profile access to one programme. Membership does not assign `profiles.tenant_id`, change a role or grant operator access.
- Heidi's approved email is `heidi@drummondheating.co.uk`. Bootstrap creates a passwordless account for her to set up through the existing password recovery flow; no invitation is sent automatically.
- Clients read only explicitly assigned programmes and submit notes as themselves. A same-tenant owner without a portal membership cannot read a programme.
- Existing platform Control Plane viewers may read programmes. Platform Control Plane admins may edit them. Reuse existing effective-dated authority; never infer it from tenant role.
- Revisions are operator-readable and append-only to browser users. Updates increment a server-side version and record the real actor. Editors keep the version from when editing began, preventing stale overwrites.
- Anonymous users cannot read any programme, membership, note or revision.

## Deployment boundary

This release starts from production commit `63733066979ec2347a7ee29fb0400b5ce89659ba`. It intentionally does not deploy the pending operational migrations dated 20260912–20261015 or the later work from the serviceos-backend-foundation branch. The isolated `20261016120000_client_portal.sql` migration depends only on already-deployed tenant, profile and platform-authority foundations.

The normal full-repo database push would also deploy unrelated pending work. For this release an isolated Supabase work directory was prepared with already-deployed migrations and only the portal migration. Its dry-run listed exactly that one addition. It was then deployed and the programme/memberships seeded with `scripts/client-portal/bootstrap.mjs --apply`. Bootstrap preserves any existing programme edits, existing users, tenant assignments and roles.

## Verification

- Typecheck and production build.
- `node --test src/lib/client-portal.test.ts src/lib/auth-errors.test.ts`: pricing/null handling, optional exclusion, URL safety and sign-in error handling.
- `supabase/tests/client_portal.test.sql`: local transaction rolled back; member isolation, same-tenant nonmember denial, no operational grant, read-only quotes, note author integrity, cross-client denial, operator edits, stale-update guard, revision history and anonymous denial.
- Browser verification uses a synthetic local user against a separate local preview, never Heidi's credentials.

## Use

Client login goes to `/login?redirect=%2Fclient`. After signing in, clients see only their assigned programme. OpenFolk admins can edit programme details, add outcome packages, prices, systems and links. Client notes persist in the programme; no notification email is sent. System statuses are manually reviewed, not automated uptime checks.

Initial data is a draft programme awaiting Heidi's Perplexity audit. The reusable schema is client-independent. Creating additional programmes and granting membership currently uses controlled administration rather than public self-signup.
