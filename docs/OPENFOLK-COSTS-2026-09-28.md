# OpenFolk operating costs — 28 September 2026

## Position

Local implementation for draft PR 46. Not deployed. No provider account was
created, no current balance verified, no purchase or auto-reload authorised, and
no financial credentials read or stored by this work. The browser security-policy
failure during AI-account setup remains unresolved. Actual Vapi billing inspection
remains open; do not bypass browser controls.

## Implemented

- Global operator-only `/openfolk/costs`, separate from client invoices.
- One account per provider/account reference, with multiple supported clients.
  Shared credit is not duplicated; client assignment is not a cost allocation.
- Vapi, OpenAI, Supabase, Vercel, telephony and other categories. No seeded figures.
- Append-only manual dashboard/invoice checks, source reference, observed time,
  server-owned actor/version, credit, dated spend, payment and auto-reload status.
- Credit and spend stay separate; currencies and unrelated periods are not summed.
  Unknown amounts stay unknown; zero remains zero.
- Low/zero credit and failed payments remain prominent even when old. Checks over
  24 hours old need refreshing. Fresh checks do not claim service uptime.
- Operator-only reads, admin-only writes, client-preview refusal, stale-write and
  invalid amount/period refusal. Explicitly no automatic cost collection or alerts.

## Verification

- 323 Node tests pass (9 new cost-health cases).
- 31 new real PostgreSQL permission/audit assertions pass in a rolled-back local
  transaction. No customer fixtures retained.
- TypeScript, scoped ESLint, Vercel-target production build pass.
- Generated route includes Costs; migration order passes across 111 files.
- No browser visual or signed-in interaction proof. Existing care database proofs
  remain the preceding checkpoint's results, not claimed rerun here.

## Required to prevent funding interruptions

1. Identify the actual Vapi organisation paying for Emma. Verify current credit,
   payment health, auto-reload, spend and any failed charges.
2. Establish funded OpenFolk AI review billing. The previous personal project test
   key was not funded and was not deployed.
3. Connect supported billing feeds with verified account identities, coverage and
   fresh receipts. Vapi call costs are usage estimates, not proof of remaining
   credit or final billed amounts. No supported balance endpoint was established.
4. Build and activate durable financial alert delivery to verified OpenFolk routes:
   low credit, failed payment and stale feed; with ownership, deduplication and
   escalation. Care-module routing does not automatically cover financial alerts.
5. Chris must approve top-up amount, threshold and budgets before purchases.
   Budget alerts are not necessarily hard caps. Hard caps may stop service.
6. Deploy reviewed schema/UI and prove operator/client/mobile flows, then prove a
   synthetic low-balance notification reaches the intended OpenFolk channel.

Keep provider-native billing alerts active throughout. Do not promise uninterrupted
service: card declines, provider outages, capacity and other limits remain possible.

## Provider source

[Vapi billing and credits](https://docs.vapi.ai/billing/manage-billing-and-credits)
documents prepaid USD credit, blocked new calls at zero credit with auto-reload
off, and configurable automatic top-ups. Saving auto-reload when already below
its threshold can charge the saved card immediately.
