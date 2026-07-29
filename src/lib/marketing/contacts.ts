/**
 * Marketing Contacts client — the single browser seam to the `marketing-contacts`
 * Edge Function. Mirrors the marketing-access client pattern: user JWT bearer,
 * server-side tenant binding, `{ ok, data, error }` envelope normalised to
 * `ApiResult`. The browser never joins or filters People locally — every list,
 * count and detail is a bounded server-side projection.
 *
 * Error codes are the function's STABLE contract (INVALID_REQUEST, NOT_FOUND,
 * FORBIDDEN, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, DUPLICATE, INTERNAL) — the
 * UI branches on `error.code`, never on message text.
 */

import { supabaseConfig, getAccessToken } from "@/lib/supabase";
import type { ApiError, ApiResult } from "@/lib/types";

export interface ContactListItem {
  person_id: string;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  created_at: string;
  created_source: string | null;
  verified: boolean;
  company_id: string | null;
  company_name: string | null;
  relationship_id: string | null;
  relationship_type: string | null;
  relationship_status: string | null;
  lifecycle_stage_key: string | null;
  owner_id: string | null;
  owner_name: string | null;
  source: string | null;
  relationship_version: number | null;
  eligibility:
    "subscribed" | "unsubscribed" | "suppressed" | "unknown" | "invalid" | "no_contact_point";
  last_interaction_at: string | null;
  last_interaction_type: string | null;
  last_interaction_direction: string | null;
  card_status: string | null;
  next_action: string | null;
  tags: { id: string; key: string; label: string; tone: string }[];
}

export interface ContactListResult {
  items: ContactListItem[];
  next_cursor: { v: string | null; id: string } | null;
  include_all_discovered: boolean;
  sort: string;
  dir: string;
}

export interface ContactCounts {
  total: number;
  classified: number;
  unclassified: number;
  suppressed: number;
  by_lifecycle: Record<string, number>;
  include_all_discovered: boolean;
}

export interface ContactListParams {
  search?: string;
  lifecycle?: string;
  relationship_type?: string;
  relationship_status?: "active" | "inactive" | "archived";
  owner_id?: string;
  company_id?: string;
  source?: string;
  eligibility?: string;
  classified?: boolean;
  tags_include?: string[];
  tags_exclude?: string[];
  created_from?: string;
  created_to?: string;
  last_contact_from?: string;
  last_contact_to?: string;
  sort?: "name" | "created" | "last_contact";
  dir?: "asc" | "desc";
  cursor?: { v: string | null; id: string } | null;
  limit?: number;
}

export interface ContactDetail extends Record<string, unknown> {
  person_id: string;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  company_id: string | null;
  company_name: string | null;
  created_source: string | null;
  verified: boolean;
  relationships: {
    id: string;
    relationship_type: string;
    lifecycle_stage_key: string;
    status: string;
    owner_id: string | null;
    owner_name: string | null;
    source: string;
    version: number;
  }[];
  contact_points: {
    id: string;
    channel: string;
    value: string;
    label: string | null;
    is_primary: boolean;
    verification_state: string;
    source: string;
    eligibility: string;
    updated_at: string;
    protected: boolean;
  }[];
  eligibility: { email: string; phone: string };
  suppressions: {
    id: string;
    channel: string;
    reason: string;
    scope: string;
    destination: string | null;
    suppressed_at: string;
  }[];
  preferences: {
    channel: string;
    topic: string | null;
    contact_point_id: string | null;
    state: string;
    source: string;
    effective_at: string;
  }[];
  tags: { id: string; key: string; label: string; tone: string }[];
  interactions: {
    id: string;
    occurred_at: string;
    interaction_type: string;
    direction: string;
    subject: string | null;
    summary: string | null;
  }[];
  customer_card: {
    id: string;
    status: string;
    priority: string;
    recommended_action: string | null;
  } | null;
}

export interface MarketingTag {
  id: string;
  key: string;
  label: string;
  tone: string;
}

export interface OwnerOption {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

export interface CreateResult {
  created: boolean;
  status?: "existing" | "ambiguous";
  person_id?: string;
  relationship_id?: string;
  conflict_id?: string;
  truncated?: boolean;
  candidate?: { person_id: string; display_name: string | null; matched_on: string[] };
  candidates?: { person_id: string; display_name: string | null; matched_on: string[] }[];
}

function toApiError(code: string, message: string, status?: number): ApiError {
  return { code, message, status };
}

async function call<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return { ok: false, error: toApiError("config_error", "Supabase is not configured") };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: toApiError("missing_auth", "You must be signed in") };

  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/marketing-contacts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let parsed: { ok?: boolean; data?: T; error?: ApiError } | null;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }
  if (response.ok && parsed?.ok && parsed.data !== undefined) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    error: toApiError(
      parsed?.error?.code ?? `http_${response.status}`,
      parsed?.error?.message ?? "Contacts request failed",
      response.status,
    ),
  };
}

export const listContacts = (params: ContactListParams = {}) =>
  call<ContactListResult>({ action: "list", ...params });

export const getContactCounts = () => call<ContactCounts>({ action: "counts" });

export const getContactDetail = (personId: string) =>
  call<ContactDetail>({ action: "detail", person_id: personId });

export const createContact = (
  details: {
    display_name: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    company_id?: string;
    owner_id?: string;
    relationship_type?: string;
    lifecycle_stage_key?: string;
  },
  idempotencyKey: string,
) => call<CreateResult>({ action: "create", details, idempotency_key: idempotencyKey });

export const classifyContact = (
  personId: string,
  changes: {
    relationship_id?: string;
    lifecycle_stage_key?: string;
    relationship_type?: string;
    status?: "active" | "inactive" | "archived";
    owner_id?: string;
    clear_owner?: boolean;
    expected_version?: number;
    allow_new?: boolean;
  },
) =>
  call<{
    relationship_id: string;
    lifecycle_stage_key: string;
    status: string;
    owner_id: string | null;
    version: number;
  }>({ action: "classify", person_id: personId, changes });

export const updateContact = (
  personId: string,
  changes: {
    person?: {
      display_name?: string;
      first_name?: string;
      last_name?: string;
      company_id?: string;
      clear_company?: boolean;
    };
    contact_points?: {
      add?: { channel: string; value: string; label?: string; make_primary?: boolean }[];
      // primary changes go through `update` items (explicit id +
      // expected_updated_at) — there is no unprotected set_primary shorthand
      update?: {
        id: string;
        expected_updated_at: string;
        value?: string;
        label?: string;
        make_primary?: boolean;
      }[];
    };
    relationship?: {
      relationship_id?: string;
      lifecycle_stage_key?: string;
      relationship_type?: string;
      status?: string;
      owner_id?: string;
      clear_owner?: boolean;
      expected_version?: number;
      allow_new?: boolean;
    };
  },
) => call<{ updated: string[] }>({ action: "update", person_id: personId, changes });

export const listTags = () => call<{ tags: MarketingTag[] }>({ action: "tags_list" });
export const createTag = (label: string, tone = "neutral") =>
  call<MarketingTag>({ action: "tag_create", label, tone });
export const assignTag = (personId: string, tagId: string) =>
  call<{ assigned: boolean }>({ action: "tag_assign", person_id: personId, tag_id: tagId });
export const removeTag = (personId: string, tagId: string) =>
  call<{ removed: boolean }>({ action: "tag_remove", person_id: personId, tag_id: tagId });
export const listOwners = () => call<{ owners: OwnerOption[] }>({ action: "owners_list" });
export const listCompanies = (search?: string) =>
  call<{ companies: { id: string; name: string }[] }>({ action: "companies_list", search });
