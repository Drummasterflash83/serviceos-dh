// ServiceOS — Identity Resolution Engine (shared, Deno). The PURE service layer.
//
// Given one interaction, it answers "who is this / what company / what site / job /
// asset?" using EVIDENCE ONLY — exact phone/email/domain matches and prior-contact
// history against the existing graph. It NEVER fabricates certainty: weak evidence
// yields POSSIBLE/UNKNOWN, strong exact evidence yields CONFIRMED, and every
// candidate carries the evidence + an explanation so the decision is explainable
// and reversible. No AI here; deterministic and generic (ServiceOS/ProductOS share
// it). Site/job/asset are structural placeholders until a job system (e.g.
// Commusoft) plugs in — returned as UNKNOWN with no fabricated match.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type Confidence = "UNKNOWN" | "POSSIBLE" | "LIKELY" | "CONFIRMED" | "REJECTED";

export interface EvidenceItem {
  source: string; // phone | email | email_domain | prior_interactions | person_company | …
  value?: string;
  detail: string;
  weight: number; // 0–1 contribution
}

export interface Candidate {
  id: string | null;
  label: string | null;
  confidence: Confidence;
  score: number; // 0–1
  evidence: EvidenceItem[];
}

export interface IdentityResolution {
  person: Candidate;
  company: Candidate;
  site: Candidate; // v1: always UNKNOWN (no sites table) — Commusoft-ready
  job: Candidate; // v1: always UNKNOWN
  asset: Candidate; // v1: always UNKNOWN
  overallConfidence: Confidence;
  evidence: EvidenceItem[];
  actions: string[];
  // The external-party identifiers we resolved against (for downstream enrichment).
  contactEmail: string | null;
  contactPhone: string | null;
  contactName: string | null;
  contactDomain: string | null;
}

const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "aol.com",
  "btinternet.com",
  "sky.com",
  "msn.com",
  "protonmail.com",
  "gmx.com",
]);

function emptyCandidate(): Candidate {
  return { id: null, label: null, confidence: "UNKNOWN", score: 0, evidence: [] };
}

export function domainOf(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return d || null;
}

export function isFreemail(domain: string | null): boolean {
  return domain !== null && FREEMAIL.has(domain);
}

interface Row {
  [k: string]: unknown;
}

/** The interaction shape this resolver needs (subset of `interactions`). */
export interface ResolvableInteraction {
  id: string;
  interaction_type: string | null;
  direction: string | null;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[] | null;
  phone_from: string | null;
  phone_to: string | null;
}

/** The external party's identifiers (customer side), by direction. */
function externalIdentifiers(i: ResolvableInteraction): {
  email: string | null;
  phone: string | null;
  name: string | null;
} {
  const outbound = i.direction === "outbound";
  const phone = (outbound ? i.phone_to : i.phone_from) ?? i.phone_from ?? i.phone_to ?? null;
  // Inbound email: the sender is the customer. Outbound: the first recipient.
  const email = outbound ? ((i.to_addresses ?? [])[0] ?? null) : (i.from_address ?? null);
  return { email: email?.toLowerCase() ?? null, phone, name: i.from_name ?? null };
}

/** Deterministic level from a 0–1 score (exact evidence only reaches CONFIRMED). */
function levelFromScore(score: number): Confidence {
  if (score >= 0.9) return "CONFIRMED";
  if (score >= 0.6) return "LIKELY";
  if (score > 0) return "POSSIBLE";
  return "UNKNOWN";
}

/**
 * Resolve identity for one interaction against the tenant's existing graph.
 * Read-only (service-role client); writes/links happen in the enrichment step.
 */
export async function resolveIdentity(
  admin: SupabaseClient,
  tenantId: string,
  interaction: ResolvableInteraction,
): Promise<IdentityResolution> {
  const { email, phone, name } = externalIdentifiers(interaction);
  const domain = domainOf(email);
  const evidence: EvidenceItem[] = [];
  const actions: string[] = [];

  // --- PERSON ---------------------------------------------------------------
  const person = emptyCandidate();
  let personRow: Row | null = null;

  if (email) {
    const { data } = await admin
      .from("people")
      .select("id, display_name, company_id")
      .eq("tenant_id", tenantId)
      .eq("primary_email", email)
      .limit(1)
      .maybeSingle();
    if (data) {
      personRow = data as Row;
      person.score = Math.max(person.score, 0.95);
      person.evidence.push({
        source: "email",
        value: email,
        detail: "Exact email match to an existing person",
        weight: 0.95,
      });
    }
  }
  if (!personRow && phone) {
    const { data } = await admin
      .from("people")
      .select("id, display_name, company_id")
      .eq("tenant_id", tenantId)
      .eq("primary_phone", phone)
      .limit(1)
      .maybeSingle();
    if (data) {
      personRow = data as Row;
      person.score = Math.max(person.score, 0.92);
      person.evidence.push({
        source: "phone",
        value: phone,
        detail: "Exact phone match to an existing person",
        weight: 0.92,
      });
    }
  }

  if (personRow) {
    person.id = personRow.id as string;
    person.label = (personRow.display_name as string | null) ?? name ?? null;
    person.confidence = levelFromScore(person.score);
    actions.push("Link this interaction to the matched person");
  } else {
    // No record — is this a KNOWN number/email (prior history) or brand new?
    let priorCount = 0;
    if (phone) {
      const { count } = await admin
        .from("interactions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .neq("id", interaction.id)
        .or(`phone_from.eq.${phone},phone_to.eq.${phone}`);
      priorCount += count ?? 0;
    }
    if (email) {
      const { count } = await admin
        .from("interactions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .neq("id", interaction.id)
        .eq("from_address", email);
      priorCount += count ?? 0;
    }
    if (priorCount > 0) {
      person.score = 0.4;
      person.confidence = "POSSIBLE";
      person.label = name;
      person.evidence.push({
        source: "prior_interactions",
        detail: `${priorCount} previous interaction(s) with this contact, but no person record`,
        weight: 0.4,
      });
      actions.push("Create a person from this contact");
    } else if (email || phone) {
      person.confidence = "UNKNOWN";
      person.label = name;
      actions.push("Create a person from this contact");
    }
  }

  // --- COMPANY --------------------------------------------------------------
  const company = emptyCandidate();
  if (personRow?.company_id) {
    const { data } = await admin
      .from("companies")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("id", personRow.company_id as string)
      .maybeSingle();
    if (data) {
      company.id = data.id as string;
      company.label = data.name as string;
      company.score = 0.9;
      company.confidence = "CONFIRMED";
      company.evidence.push({
        source: "person_company",
        detail: "Company inherited from the matched person",
        weight: 0.9,
      });
    }
  }
  if (!company.id && domain && !isFreemail(domain)) {
    const { data } = await admin
      .from("companies")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("domain", domain)
      .limit(1)
      .maybeSingle();
    if (data) {
      company.id = data.id as string;
      company.label = data.name as string;
      company.score = 0.85;
      company.confidence = "LIKELY";
      company.evidence.push({
        source: "email_domain",
        value: domain,
        detail: "Email domain matches an existing company",
        weight: 0.85,
      });
    } else {
      company.score = 0.4;
      company.confidence = "POSSIBLE";
      company.label = domain;
      company.evidence.push({
        source: "email_domain",
        value: domain,
        detail: "Business email domain with no company record yet",
        weight: 0.4,
      });
      actions.push("Create a company from the email domain");
    }
  }

  evidence.push(...person.evidence, ...company.evidence);

  return {
    person,
    company,
    site: emptyCandidate(), // Commusoft-ready placeholder — no fabricated site
    job: emptyCandidate(),
    asset: emptyCandidate(),
    overallConfidence: person.confidence,
    evidence,
    actions,
    contactEmail: email,
    contactPhone: phone,
    contactName: name,
    contactDomain: domain,
  };
}

/** Map an engine Confidence to the interaction_match_suggestions match_level. */
export function matchLevelOf(c: Confidence): string {
  switch (c) {
    case "CONFIRMED":
      return "confirmed";
    case "LIKELY":
      return "likely";
    case "POSSIBLE":
      return "possible";
    case "REJECTED":
      return "rejected";
    default:
      return "possible";
  }
}
