# Client investment release — 24 September 2026

Scope: private tenant-scoped invoice metadata/downloads, delivery snapshot, invoice-style homepage wordmark and client login polish. No operational ingestion, new provider settings, quote prices or invitations activated.

Production backend: isolated migration `20261018120000_client_invoices.sql` applied to project `tgbnakbxwcqjeimygroz`. Private `client-invoices` bucket; browser access is read-only and explicitly requires portal membership or existing OpenFolk operator authority. Invoice files are not in Git or public frontend assets.

DH publication: eight invoices, paid £9,508, outstanding £1,750. Loan excluded. New unpaid duplicate 007 corrected to 008; originals preserved outside Git. PDF issue dates retain original values. Outcome descriptions distinguish invoiced work from accepted features; shared build is not falsely attributed to individual bills. Payment basis is Chris's confirmed bank totals, not automated bank reconciliation.

Proofs: TypeScript and production build passed; three existing programme unit tests passed. Rollback-only SQL assertions passed for client totals and file access, unrelated identity denial, anonymous denial, no browser invoice writes and private bucket. Invoice 008 rendered and visually checked. Unauthenticated login visually checked locally; local dev has no auth environment by default. Authenticated browser and live release checks must be recorded separately.

Deployment: frontend only via PR to main. Keep unrelated untracked launch-readiness helper unchanged. No pending operational migrations deployed. Hide frontend invoice entry to roll back UI if necessary; keep financial records intact. Do not delete invoices to roll back presentation.

Not included: fixed-quote acceptance workflow, pricing publication, automatic bank reconciliation, actual Birchills configuration changes, main-number activation, domain DNS cutover, Heidi invitation. No internal rate/day/profit forecasts in the client data.
