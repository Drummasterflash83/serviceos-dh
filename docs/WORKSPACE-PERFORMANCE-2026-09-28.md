# Workspace loading — 28 September 2026

## Changes

- OpenFolk released modules no longer wait for workspace discovery, readiness and audit requests. Those three requests run only when Future tools are opened. The large legacy tool component is dynamically loaded there.
- Gated `tenants.directory` action reads only tenant IDs, slugs and display names with pagination. Original `tenants.list` remains intact for older consumers. Previously each tenant required five extra inventory queries, all unused by the new module directory.
- Programme, invoice, delivery-editor and phone-planner code is loaded on demand.
- Homepage and receptionist use one user/tenant-scoped call query: shared in-flight work and a 45-second freshness window, retaining 60-second polling. Reloads create a fresh cache; explicit refresh invalidates it.
- Programme notes load on their own page; training configuration on practice/details; receptionist feedback/delivery data on improvements. Invoice-only operator view does not request the hidden delivery summary.
- Access checks, RLS, writes, call configuration and client branding unchanged.

## Evidence

Static JavaScript dependency closure measured from local production builds, including shared framework code; not a browser load-time claim:

| Entry | Before raw / gzip bytes | After raw / gzip bytes |
|---|---:|---:|
| OpenFolk tenant route | 978,187 / 280,968 | 707,516 / 211,923 |
| Client portal | 781,293 / 230,540 | 778,765 / 231,409 |

OpenFolk gzip reduction: approximately 24.6%. Client bundle size is essentially unchanged; its gain is fewer unnecessary requests and duplicate provider reads, not a claimed bundle-size reduction.

129 focused tests passed, including real QueryClient in-flight deduplication, fresh-cache reload, explicit invalidation and user/tenant separation. TypeScript, targeted lint (two pre-existing warnings), production build and bundled Vapi constructor proof passed. `scripts/workspace-bundle-proof.mjs` verifies Future tools and invoices are not static dependencies.

No authenticated live-browser timing or visual proof is claimed: the browser-control policy check remains unavailable. Provider response latency and hosting cold starts may still contribute to delay.
