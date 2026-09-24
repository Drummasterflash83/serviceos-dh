# Unified client workspace — navigation and review

Built from production `0ec25ac` (retains the approved shared wordmark, build guard and
zero-JavaScript public homepage). No provider, database, DNS, billing, invitation or
recording changes are included.

## Journey

- Normal sign-in still leads to `/client`, now the client's workspace home rather
  than their proposal. Explicit deep links remain supported.
- Home provides a prominent AI Receptionist entry plus Programme, Invoices & delivery
  and Feedback cards. It uses the actual tenant's receptionist name/recorded launch
  stage, with loading, unavailable/retry and unassigned states. A stage is not a
  fabricated uptime or satisfaction score.
- Both sidebars use the company-name dropdown: Home, Receptionist, Programme,
  Invoices. Radix supplies keyboard navigation, focus handling and dismissal.
- Emma has a purple top-level Back to workspace link and a Workspace home sidebar
  entry. All routes retain the selected tenant. Explicit inaccessible selections
  refuse to display another client's workspace.
- Client sections are URL-backed, so refresh and browser Back/Forward retain context.
  Sign-in return URLs now retain the query, including tenant and section.
- Both workspaces use the same dark purple sidebar/paper/lavender language and the
  white/gold wordmark on dark backgrounds. Mobile navigation scrolls horizontally;
  home cards stack at 800px and primary controls remain at least 44px high.
- Operator editing controls are OFF by default in the client programme. An actual
  authorised operator can enable them explicitly; this does not impersonate Heidi,
  change permissions or simulate another user's data access. RLS remains authoritative.
- A separate **OpenFolk admin** button sits in both sidebar footers. It is visible
  only when the signed-in email is `chris@openfolk.ai` AND the existing server RPC
  confirms admin operator authority. Other users and pending/failed authority checks
  see no button. It navigates to the existing guarded `/openfolk` route in the same
  session, independently of the editing toggle; it never signs anyone out or grants access.

## Checks and release boundary

TypeScript, production-target build, 18 prebuild brand/navigation checks, five
homepage-output checks and three programme-contract tests pass. Targeted lint has
no errors; the existing auth module's react-refresh export warning remains.

Automated access to the signed-in application was retried but denied because the
admin-enforced browser policy could not be verified. This must not be bypassed through
another browser, proxy, local copy or extracted session. Therefore no authenticated
browser or mobile visual acceptance is claimed. Keep this larger redesign in preview
until the authorised user has checked the actual screens below.

## Short acceptance walkthrough (Chris, normal login)

1. Open preview `/client`: client home, white/gold logo on dark purple, no edit buttons
   in the page heading. Existing programme/invoice data are unchanged.
2. Open the Drummond Heating company menu with pointer and keyboard. Choose AI
   Receptionist. Confirm the company remains Drummond and the header return action is
   visible; choose Back to workspace and confirm it returns to Home.
3. Open Programme and Invoices; refresh and use browser Back/Forward. Confirm section
   and tenant remain correct and invoice download still works under the normal login.
4. Inspect on a narrow/mobile viewport: no page-width overflow, menu visible, buttons
   reachable, home cards stacked. Check the purple theme on Programme and invoice pages.
5. Operator only: enable editing tools, then return to client view. Ordinary client
   accounts must never see this control. Do not change client data merely for testing.

No new claim about Emma's audio playback, call quality, sentiment or phone-line health
is established by this navigation release. Those separate pending changes stay separate.
