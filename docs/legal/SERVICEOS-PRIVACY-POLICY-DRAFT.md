# Drummonds — OpenFolk ServiceOS privacy notice

**Draft for review · 13 October 2026 · Not published or effective.**
This notice is for Drummonds’ deployment only. The proposed commitments below need approval and operational verification
through [the launch approval pack](SERVICEOS-QUICKBOOKS-APPROVAL.md) before publication. It does not describe Drummonds as the operator of OpenFolk
for other clients or certify that planned controls are already operational.

## 1. Who is responsible

**DRUMMOND HEATING LTD.**, company number **07556814**, is responsible for the
purposes of processing described in this notice. Its registered office is
**Unit 15 Westlink Belbins Business Park, Cupernham Lane, Romsey, Hampshire,
England, SO51 7JF**. In this notice, “Drummonds”, “we” and “us” mean that company.

Contact: **Chris Drummond, chris@drummondheating.co.uk**, marked “ServiceOS privacy”,
or write to our registered office. Chris is the nominated contact for privacy,
support and security enquiries about this deployment; this is not a designation
as a statutory data protection officer.
Effective date: to be set when this notice is approved and published.

Drummonds uses OpenFolk ServiceOS to bring together its customer, job,
communication and business information. This is Drummonds’ internal application,
developed and supported by Chris Drummond, who supplies the software personally
and works directly with Drummonds. OpenFolk ServiceOS is the software name; this
notice does not identify a separate OpenFolk company as the supplier. Technical
administration is carried out under Drummonds’ authorisation and instructions.

This notice concerns our ServiceOS deployment. It supplements, rather than silently
replaces, any existing Drummonds customer, workforce or website privacy notices.

## 2. What information comes into ServiceOS

Information depends on the enabled modules, source permissions and agreed import
scope. It may include:

- Customer, supplier and staff names, contact details, addresses and identifiers.
- Customer accounts, sites, job records, appointments, progress and operational notes.
- Emails and metadata; call details, recordings and transcripts; voicemails;
  authorised channel messages, replies and participant details.
- Accounting contacts and transactions, including invoices, payments, credits,
  bills, estimates, balances and the references linking those records.
- Account roles, support correspondence, access logs and technical diagnostics.
- Derived summaries, linked timelines, extracted tasks and indicators based on
  the available records.

Sources include people who contact or work with us, our authorised users, and
connected business systems such as Google Workspace, our phone provider, Slack,
Commusoft and, once authorised, QuickBooks Online. The relevant configuration
controls what is captured. Source retention, access restrictions and technical
failures can limit completeness or freshness.

Our current Slack rollout excludes individual and group direct messages. A
change to that scope would require a separate decision, appropriate access and
notice. Not every feature listed in this draft is enabled or verified today.

## 3. Purposes and legal bases

We use the selected information to understand customer needs and job progress,
follow up communications, identify outstanding work, reconcile business records,
manage operations, and investigate service problems. Our authorised technical
support personnel may diagnose issues and improve our implementation under our
instructions.

The proposed purpose/basis mapping is:

| Purpose | Proposed basis, subject to confirmation |
| --- | --- |
| Deliver heating services contracted directly with an individual | Performance of that contract |
| Coordinate business customer work, supplier relationships and operational follow-up | Legitimate interests in managing our business and service delivery |
| Maintain financial records required by applicable law | Legal obligation; identify the relevant requirements in our processing record |
| Secure the workspace, manage access and investigate misuse | Legitimate interests in protecting information and systems |
| Optional processing that requires consent | Consent, where required and actually obtained |

**For approval:** Drummonds must adopt the purpose/basis mapping and complete
any required assessments and workforce notices before the relevant processing.
A customer contract does not supply the basis for every correspondent or employee. Any special-category or criminal-offence data needs
separate assessment and applicable conditions; its incidental presence does not
by itself authorise new analysis.

Some contact and job details are necessary to provide our services; account
information is necessary to provide a ServiceOS login. We explain any required
information and the consequences of not supplying it at the relevant collection
point. An administrator can decline a connector, limiting the related insight.

## 4. QuickBooks Online

Once enabled, an authorised administrator connects our specific QuickBooks company
through Intuit’s authorisation process. The connector uses access tokens rather
than a user’s QuickBooks password. It reads the agreed accounting records to help
understand invoices, balances, payments and their relationship to our work.

The initial ServiceOS connector is designed not to create, edit or delete
accounting transactions or initiate payments. Intuit’s Accounting permission
includes read and write capability; ServiceOS restricts its implementation to
reads. The separate payment-processing API and payroll are outside this initial
connection.

QuickBooks data is excluded from model training and fine-tuning. The current
connector does not send QuickBooks records to an AI processing pipeline.

An authorised administrator can revoke access through Intuit’s connected-app
controls or request disconnection through our ServiceOS support contact.
Disconnection does not change our records in QuickBooks or automatically erase
copies already retained in ServiceOS. Retention and deletion are handled separately.

**Launch check:** the sandbox read-only import is verified. Drummonds' live
connection and the complete disconnect/reconnect lifecycle must be verified
before this notice is published as describing an available live connection.

## 5. AI and performance analysis

Enabled AI or speech features may send relevant information to the disclosed
providers to create summaries, transcripts or other requested outputs. Such outputs
can be inaccurate, incomplete or linked to the wrong record. Important conclusions
must be checked against the underlying evidence.

Performance indicators, if enabled, require an explanation of their measures,
coverage, purpose and correction process. Our proposed policy requires meaningful
human review before decisions about pay, employment or other significant outcomes.
A score is not an automatic instruction to change someone’s pay or employment.
Any such feature requires assessment and appropriate workforce information before use.

**Proposed data-use restriction:** identifiable workspace information will not be
sold, used to train general-purpose models or reused for unrelated client datasets.
Client-specific support and software improvement remain within the agreed purposes.
Verify and adopt this commitment in supplier contracts and configuration before
publication; this draft does not claim that every AI provider offers zero retention.

## 6. Access and recipients

Access is limited to authorised Drummonds users and permitted support personnel,
according to their roles and relevant source permissions. Authorised OpenFolk
operators can access relevant Drummonds information to support the service and
improve our implementation, using explicit client selection and auditable actions.
That access does not permit disclosure of our underlying records to another client.

The current technical provider inventory is:

| Provider | Service and relevant information |
| --- | --- |
| Supabase | Authentication, database, private storage and server functions; QuickBooks records and encrypted connection credentials are stored here. Production database region is London; TEST is Ireland. |
| Vercel | Hosts the ServiceOS frontend and web request handling. Authorised browsers retrieve accounting views from the backend; do not assume all accounting payloads pass through Vercel. |
| AWS | Independent encrypted database and recording recovery storage in London, where included in approved backup scope. Database backups can contain retained accounting records. |
| Cloudflare | Domain/DNS services; traffic-processing role and applicable logs must be confirmed for the deployed hostname. |
| OpenAI and Vapi | Enabled AI and voice features elsewhere in ServiceOS. The current QuickBooks connector has no path sending its records to these services. |
| Google Fonts | The existing application loads font resources from Google, which receives network request information. |

**Launch check:** confirm the actual account contracts, subprocessors, supplier
support access and transfer safeguards before adopting this inventory as the
final recipient schedule. Connected providers retain their separate roles.
Intuit and other connected providers also process information under their own
terms and privacy notices.

Information may be shared with professional advisers under appropriate duties,
where legally required, or in a lawful business transfer with appropriate safeguards.

## 7. Security and international processing

The service uses access restrictions, protected server-side credentials, private
storage and recovery controls. No system can promise absolute security. Users
should protect their accounts and report suspected unauthorised access through
Chris Drummond at the contact above, marked “ServiceOS security”.

Some suppliers or their support teams may process information outside the UK.
Production Supabase database storage and the independent AWS backup destination
are in London; TEST Supabase is in Ireland. Supplier support and other services
can involve additional countries. The final supplier schedule must identify the
applicable UK transfer safeguard for each relevant flow before launch. Copies
of the applicable safeguards can be requested from our privacy contact. London
backup storage does not establish UK-only processing.

## 8. Retention and deletion

We determine retention according to the purpose of each category, operational
need and applicable legal requirements. Workspace history, financial records,
recordings, access logs and account information need separate schedules.

Disconnecting a source, deleting an original record and deleting its retained
ServiceOS copies are different actions. A deletion request may also need to cover
historical versions and derived records. We assess requests and explain any lawful
reason for retaining particular information.

Backups can have separate expiry and deletion-protection periods. Copies awaiting
disposal remain restricted to recovery and authorised purposes. Applicable deletion
instructions must be reapplied if a backup is restored.

**Proposed pilot retention for approval:** review retained copies at the end of
the 90-day pilot. Keep records longer only where necessary for an identified
continuing service, open job/dispute, or legal obligation, and record the reason
and next review date. Source-system accounting records retain their separate
retention requirements.

**Proposed exit targets:** provide a 30-day export opportunity after termination,
remove active copies within 30 days after return/deletion is agreed, and remove
recovery copies within 90 days after active deletion, subject to documented legal
exceptions. Current backups have minimum locks and some have no automatic expiry.
These targets must be approved and verified across source versions, derived
records and recovery copies before publication. This draft does not delete data.

## 9. Your rights

Depending on the processing and applicable law, you may request access,
correction, erasure, restriction or portability of personal information. Where
we rely on consent, you may withdraw it without affecting earlier lawful processing.

**You may object to processing based on legitimate interests. You may object to
direct marketing at any time.** Contact us using the details above. We may need
to verify your identity; not every right applies in every circumstance.

You can complain to the [UK Information Commissioner’s Office](https://ico.org.uk/make-a-complaint/)
or another relevant supervisory authority where applicable. You do not need to
contact us first, although we welcome the opportunity to resolve concerns.

## 10. Website technologies and changes

ServiceOS stores its sign-in session in browser local storage and refreshes it
while authorised. It also uses local storage for selected workspace/connection
preferences and saved operator action drafts, session storage for a selected
call, and a sidebar preference cookie with a seven-day lifetime. Local-storage
items can persist until removed or browser data is cleared; closing a tab does
not necessarily remove them. Use a trusted device and sign out when finished.

The existing application requests Google-hosted fonts. Hosting/security services
may process request logs. No optional analytics SDK was identified in the inspected
application source, but this is not a completed network/cookie audit of every
enabled module. The final cookie inventory and any required choices must match
the deployed behaviour before publication.

We will date updates and provide appropriate notice of material changes. Updating
this notice does not itself authorise a new purpose for personal information.
