# Build 01 — current Commusoft job freshness

**Status, 16 October 2026, 05:04 UTC:** preparation only. The current
read-only recurring connection remains in its approved scope. No Commusoft
webhook was registered, no provider setting was changed, and no new source job
was queued by this work.

The [aggregate LIVE readback](evidence/learn-build01-worker-pressure-2026-10-16.json)
found one enabled recurring account in the customer-contact phase. Its last
retained job page was committed at 02:18 UTC; the following hour committed 580
empty customer-contact pages. The protocol checks customer and work-address
contacts before advancing its watermark and starting another jobs pass. It
preserves broad contact coverage, but a current job card cannot treat that
02:18 page as proof of the job's status at 05:00. The Commusoft, Email and Slack
worker counts are separate observations, not proof that one lane starves another.

Commusoft's [webhook documentation](https://developer.commusoft.com/webhooks-2114965m0)
describes signed, thin notifications for job creation and updates. It specifies
an HMAC-SHA256 over the delivery timestamp, a period and the raw JSON body;
the event identifies a job but does not contain the current job record. A
successful event therefore must trigger a guarded, read-only GET through the
existing tenant and connection, then commit an actual source version before
any card can change. Delivery alone is never job-progress evidence. The
provider can retry, and a paused webhook can lose events, so the existing
polling cycle remains a reconciliation path.

An inert local [`webhook_boundary.ts`](../../supabase/functions/_shared/commusoft/webhook_boundary.ts)
now verifies the documented signature and freshness window, exact application
and client identities, UK API origin and positive job ID. It accepts only
`job.created` and `job.updated`; property, delete and other event types remain
out of scope. Its return value contains only an event ID, action, job ID and
source timestamp, never the supplied body or a job status. Three synthetic
boundary tests and repository TypeScript pass. This is **not** a receiver, a
subscription, a durable hint, a source fetch or a publication path.

Before activation, the implementation must add durable event-ID deduplication,
revalidate the current approved tenant/connection in the persistence
transaction, reserve the existing Commusoft quota, fetch the fixed job endpoint
without trusting the event URL, retain the source response through the current
versioned writer, handle 404/deletion without erasing history, and test retries,
revocation, stale events and provider gaps in TEST. It must prove a LIVE
job-change-to-card journey and preserve a slower full-list reconciliation.
Registering the webhook in Commusoft changes a source-provider setting; the
current Build 01 authorization expressly excludes that action. It needs an
exact-scope approval after the complete receiver and processor are reviewable.
