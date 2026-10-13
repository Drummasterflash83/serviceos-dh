# QuickBooks launch approval pack

**Prepared for Chris and Heidi Drummond • 13 October 2026**

The QuickBooks sandbox connection and a repeatable sample import work. Drummonds' real accounts are not connected yet. This pack separates the documents for business approval from technical and Intuit checks still needed for live access.

## Documents to review

- [Drummonds privacy notice](SERVICEOS-PRIVACY-POLICY-DRAFT.md)
- [Authorised-user terms](SERVICEOS-TERMS-DRAFT.md)
- [Chris and Drummonds pilot agreement](SERVICEOS-DRUMMONDS-PILOT-AGREEMENT-DRAFT.md)

The policy pages are approval previews, not published policies. The agreement is private and must not be published as an Intuit policy page. Public destinations after approval are /privacy/drummonds and /terms/drummonds on www.openfolk.ai.

## Already confirmed

- Drummonds is the internal app operator. Chris supplies the software personally.
- Heidi signs for Drummonds; Chris is the supplier and security-risk review owner.
- Pilot: 90 days, no separate software fee, pre-approved third-party costs only, 30 days' termination notice, existing software ownership unchanged.
- QuickBooks records must not be used for model training or fine-tuning.
- No legal-counsel review has taken place. An agreement between the parties does not change that answer.

## Decisions for Chris and Heidi

1. Approve or amend the actual privacy notice, user terms and pilot agreement. Agreement approval is separate from signing it.
2. Confirm Heidi's contractual notice email and authority to sign, and Chris's actual processing role and software rights. The drafts avoid transferring ownership or inventing a separate OpenFolk company.
3. Agree the proposed exit targets: 30-day export opportunity, active-data deletion within 30 days after return/deletion is agreed, recovery-copy deletion within 90 days after active deletion. Engineering must verify these before promising them; existing records are not deleted by approval of a draft.
4. Adopt the recorded security review responsibilities, business purposes and supplier arrangements. No artificial compliance certification is implied.

## Engineering checks

Sandbox evidence: 29 customers, 31 invoices, 16 payments and 1 credit note; a repeated import retained 77 records with no duplicate source versions. Capture is paused. This does not establish live coverage.

ServiceOS uses WebSockets for Supabase live-call updates; QuickBooks uses HTTPS requests. CAPTCHA is currently disabled. Supabase permits TOTP enrolment/verification, but ServiceOS's current sign-in UI has no verified MFA challenge. These facts must be reflected accurately in the Intuit assessment.

Production data is hosted in Supabase's London region; TEST is in its Ireland region. Recovery storage is configured in AWS London. These locations do not establish UK-only supplier support or all processing. Supplier contracts and transfer safeguards need verification.

Remaining checks include the complete provider token-refresh/disconnect/reconnect lifecycle, deployed release/runtime verification, production access isolation, export/deletion handling and the final supplier/security evidence. The supporting operations record holds current results.

## Final live steps

- Publish only the approved privacy notice and user terms, verify public access at their stable URLs, and enter those URLs in Intuit.
- Review and approve the complete, accurate Intuit assessment before submitting it. Intuit decides whether further review is needed.
- When production credentials are available, provision them through the approved server-side process. Use the real Drummonds QuickBooks administrator to confirm the exact company and consent scope.
- Verify one bounded live read/import, accounting totals and currency, customer links and isolation before enabling ongoing capture. Never infer job matches from an old QuickBooks code alone.

## Review basis

The drafts use the [ICO privacy-information guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/) and [processor-contract guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/), checked on 13 October 2026. The ICO marks these pages as under review following legislative changes. These are practical approval drafts, not a legal opinion or a certification of compliance.
