# ServiceOS legal drafts — owner and release review

Prepared 13 October 2026 at Chris's request. These drafts are saved in the
QuickBooks integration branch, not published, accepted or submitted to Intuit.
They need factual completion and review by a suitably qualified UK adviser before
use as the business's legal terms. They do not establish legal compliance.

- [Privacy policy draft](SERVICEOS-PRIVACY-POLICY-DRAFT.md)
- [Drummonds end-user terms / EULA draft](SERVICEOS-TERMS-DRAFT.md)

## Confirmed direction and identity

Chris instructed: “Use Drummonds for this inc their company details”. The drafts
therefore cover **Drummonds' deployment**, with Drummonds as the responsible
business/controller and OpenFolk as its software/support supplier. They do not
claim that Drummonds owns OpenFolk or operates the service for future clients.
The terms are internal authorised-user terms, not a contract in which Drummonds
purports to sell OpenFolk subscriptions to itself.

[Companies House](https://find-and-update.company-information.service.gov.uk/company/07556814)
identifies **DRUMMOND HEATING LTD.**, number **07556814**, registered office
**Unit 15 Westlink Belbins Business Park, Cupernham Lane, Romsey, Hampshire,
England, SO51 7JF**. Its [own website](https://drummondheating.co.uk/) publishes
**office@drummondheating.co.uk**. Both were checked on 13 October 2026. The public
email is a proposed request-routing contact, not evidence of a designated DPO or
an established support/privacy response process.

## Decisions needed from the business

| Decision | Current position |
| --- | --- |
| Drummonds identity | Verified above and inserted in both drafts. Confirm notices align with the organisation's existing policies before adoption. |
| OpenFolk supplier | Legal entity and agreement still need identifying. Drummonds' details cannot be substituted for its separate supplier. |
| Privacy, support, security and formal notices | Published office mailbox inserted as proposed routing contact; confirm responsible people and escalation. |
| Retention and exit | Agree category-specific retention, export window, deletion timing and maximum backup retention. No changes to retained source data are authorised by drafting. |
| AI and product improvement | Proposed: authorised client-specific support/improvement; no sale, unrelated client reuse or general-purpose training of identifiable customer data. Verify supplier terms/configuration before promising it. |
| Commercial terms | Keep fees, renewal and supplier liabilities in the separate Drummonds–OpenFolk agreement. Review internal EULA remedies, licence chain and jurisdiction. |
| Data-processing agreement | Separate signed agreement and processing/security/subprocessor schedules are needed; the privacy notice is not a substitute. |

## Engineering and operational verification

- The QuickBooks app exists, but no real company is connected and no financial
  import has been accepted. Code tests demonstrate local transport boundaries,
  not production compliance, availability or data coverage.
- Confirm all actual data flows, suppliers, subprocessors, locations, support
  access, contracts and transfer safeguards. Vercel, Supabase, AWS, Cloudflare,
  OpenAI and Vapi are inventory leads from this repository, not a complete
  certified list or assertion that each receives QuickBooks data.
- Confirm purpose/basis mapping and document legitimate-interest assessments
  where appropriate. Customer-as-controller remains responsible for its own
  notices and lawful processing, including call capture and staff scoring.
- Test disconnect/revocation, support requests, export, deletion and restoration
  handling before promising those processes. Do not claim UI controls exist
  merely because a clause describes a planned support process.
- Existing AWS backups use 30-day minimum deletion protection and can have no
  automatic expiry. Do not claim universal 30-day deletion, a guaranteed daily
  backup, UK-only processing or a recovery service level from that configuration.
- Audit website cookies, local storage, telemetry and third-party resources;
  distinguish essential operation from optional processing and implement choices
  where needed. The repository has no verified public cookie inventory.
- Review workforce scoring and significant-decision safeguards before activation.
  A future feature needs its own processing assessment and appropriate notice.

## Publication sequence

1. Resolve placeholders and verify commitments; complete legal/business review.
2. Implement the required support, data handling and public-page functionality.
3. Add stable public routes, proposed as `https://www.openfolk.ai/privacy/drummonds`
   and `https://www.openfolk.ai/terms/drummonds`. These routes are proposals, not live URLs.
   Check anonymous access, mobile layout, links, effective dates and consistency
   with the signed supplier agreement and existing Drummonds notices. No acceptance
   is implied by this draft. Generic OpenFolk policies for other clients need their
   own correct legal operator and scope.
4. Publish the approved text through the established Vercel release process.
5. Enter the verified URLs in the new Intuit app and complete its assessment using
   evidence, distinguishing implemented controls from planned work. Never answer
   “yes” to an unverified control solely to obtain production credentials.

## Reference basis and limits

These are original ServiceOS drafts based on the requested product scope and
repository evidence. They are not copied Intuit terms. The current Intuit portal
requires public EULA/privacy links and an app assessment before production keys
are released. Review Intuit's [Developer Terms](https://static.developer.intuit.com/output_html/tos/docs/tos.html)
alongside the account's actual applicable agreement; do not accept new terms as
part of drafting these documents.

The [ICO privacy-information checklist](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/)
informed the review fields for identity, sources, purposes, bases, recipients,
retention, transfers and rights. Its page says guidance is under review following
the Data (Use and Access) Act; check current guidance before final adoption.

The [ICO storage-limitation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)
supports defining retention by purpose instead of retaining personal information
indefinitely by default. The [ICO controller/processor guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/)
informs the separate processing-agreement requirement. The [ICO transfer guide](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-guide-to-international-transfers/)
informs the need to verify locations, overseas access and safeguards. These
references do not validate OpenFolk's current contracts or technical configuration.
