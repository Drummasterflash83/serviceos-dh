// ServiceOS — Edge Function: customer-health-shadow
//
// Chris-only (Tenant-Superadmin) shadow surface for Customer Health (callback). It
// observes, explains and lets the superadmin review — it NEVER creates canonical
// operational work. Every action requires an ACTIVE tenant.superadmin grant, checked
// server-side (the same model as view-as). Writes go only to health_* tables (+ an
// append-only corrections row for correction-class decisions).
//
//   POST {action:'list'}                              → the shadow surface (read-only)
//   POST {action:'process', candidates:[...]}         → run shadow pipeline on candidates
//   POST {action:'review', proposal_id, decision,...} → apply a governed review decision
//
// Runtime: Deno. Deploy with verify_jwt=false (auth enforced via requireTenantUser).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { loadCallbackConfig, processCandidate } from "../_shared/health/store.ts";
import {
  applyReviewDecision,
  loadShadowSurface,
  type ReviewDecision,
} from "../_shared/health/review.ts";
import type { CommunicationInput } from "../_shared/health/types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "content-type": "application/json" },
  });
const fail = (code: string, message: string, s: number) =>
  json({ ok: false, error: { code, message } }, s);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deno duck-typed rows/client (matches view-as)
type Row = Record<string, any>;

const activeGrant = (g: Row, now: number) =>
  (g.effective_from ? Date.parse(g.effective_from) : -Infinity) <= now &&
  (g.effective_to ? Date.parse(g.effective_to) : Infinity) > now;

// Same Tenant-Superadmin resolution as view-as: an ACTIVE tenant.superadmin grant on
// the caller's team_members row. RLS additionally enforces this at the data layer.
async function actorIsSuperadmin(
  admin: Row,
  tenantId: string,
  userId: string,
  now: number,
): Promise<boolean> {
  if (userId === "service") return true; // internal service-to-service (tests/operator)
  const { data: member } = await admin
    .from("team_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("profile_id", userId)
    .is("effective_to", null)
    .maybeSingle();
  if (!member) return false;
  const { data: grants } = await admin
    .from("authority_grants")
    .select("permission, effective_from, effective_to")
    .eq("tenant_id", tenantId)
    .eq("member_id", member.id)
    .eq("permission", "tenant.superadmin");
  return (grants ?? []).some((g: Row) => activeGrant(g, now));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId } = auth.ctx;
  const actorRef = auth.ctx.email ?? userId;
  const now = Date.now();

  // Every action is Tenant-Superadmin only.
  if (!(await actorIsSuperadmin(admin, tenantId, userId, now))) {
    return fail("forbidden", "Customer Health shadow is Tenant-Superadmin only.", 403);
  }

  let body: Row = {};
  try {
    body = ((await req.json()) ?? {}) as Row;
  } catch {
    body = {};
  }
  const action = String(body.action ?? "list");

  try {
    if (action === "list") {
      const surface = await loadShadowSurface(admin, tenantId);
      return json({ ok: true, data: surface });
    }

    if (action === "process") {
      const config = await loadCallbackConfig(admin, tenantId);
      const raw = Array.isArray(body.candidates) ? body.candidates : [];
      const results = [];
      for (const r of raw) {
        const c = normaliseCommunication(r);
        if (!c) continue;
        const out = await processCandidate({
          db: admin,
          tenantId,
          communication: c,
          config,
          companyConfidence: typeof r.company_confidence === "number" ? r.company_confidence : null,
          nowMs: typeof body.now_ms === "number" ? body.now_ms : now,
        });
        results.push(out);
      }
      return json({
        ok: true,
        data: {
          policyPublished: config.published,
          sourceAllowlistEnabled: config.sourceAllowlistEnabled,
          processed: results.length,
          results,
        },
      });
    }

    if (action === "review") {
      const decision = String(body.decision ?? "") as ReviewDecision;
      const proposalId = String(body.proposal_id ?? "");
      if (!proposalId) return fail("bad_request", "proposal_id is required", 400);
      const res = await applyReviewDecision(admin, tenantId, {
        proposalId,
        decision,
        actor: actorRef,
        reason: body.reason ?? null,
        correctedTitle: body.corrected_title ?? null,
        correctedOutcome: body.corrected_outcome ?? null,
        correctedResponsibility: body.corrected_responsibility ?? null,
        correctedDueAt: body.corrected_due_at ?? null,
        attachToProposalId: body.attach_to_proposal_id ?? null,
      });
      if (!res.ok) {
        // A PARTIAL failure means the proposal state DID change but a later write
        // failed — distinguish it (500 + partial flag) from a pre-write validation
        // reject (400) so the reviewer knows the surface state has moved.
        const partial = "partial" in res && res.partial === true;
        return json(
          {
            ok: false,
            error: {
              code: partial ? "review_partial_failure" : "review_failed",
              message: res.error,
            },
            partial,
          },
          partial ? 500 : 400,
        );
      }
      return json({ ok: true, data: res });
    }

    return fail("bad_request", "unknown action (list|process|review)", 400);
  } catch (e) {
    return fail("shadow_error", (e as Error).message, 500);
  }
});

function normaliseCommunication(r: Row): CommunicationInput | null {
  if (!r || !r.interaction_id) return null;
  return {
    interactionId: String(r.interaction_id),
    interactionType: r.interaction_type ?? null,
    direction: r.direction ?? null,
    occurredAt: r.occurred_at ?? null,
    fromName: r.from_name ?? null,
    fromAddress: r.from_address ?? null,
    phoneFrom: r.phone_from ?? null,
    phoneTo: r.phone_to ?? null,
    subject: r.subject ?? null,
    summary: r.summary ?? null,
    bodyPreview: r.body_preview ?? null,
    intent: r.intent ?? null,
    sentiment: r.sentiment ?? null,
    disposition: r.disposition ?? null,
    callerKind: r.caller_kind ?? null,
    queue: r.queue ?? null,
    extension: r.extension ?? null,
    requestedName: r.requested_name ?? null,
    relatedPersonId: r.related_person_id ?? null,
    relatedCompanyId: r.related_company_id ?? null,
    metadata: r.metadata ?? {},
  };
}
