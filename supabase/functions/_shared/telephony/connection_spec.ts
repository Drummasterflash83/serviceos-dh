// ServiceOS — Provider CONNECTION SPEC (PURE, provider-neutral).
//
// Each adapter DECLARES what it needs to connect — fields, auth mode, validation, OAuth /
// webhook / IP-allowlist requirements, account-reference format, help + docs, and whether
// the path is self-service or provider-assisted/manual. The generic onboarding UI renders
// itself entirely from this declaration: there is NO provider-specific form code anywhere.
//
// Secrets are declared (`secret: true`) so the broker knows what to store in Vault and the
// UI knows never to echo a stored value. Unsupported connection modes are represented
// honestly (manual: true, oauth.supported: false, …) rather than faked.

import type { AuthMode } from "./adapter.ts";

export type ConnectionFieldType =
  "text" | "secret" | "select" | "url" | "region" | "textarea" | "boolean";

export interface ConnectionFieldOption {
  value: string;
  label: string;
}

export interface ConnectionFieldValidation {
  pattern?: string; // regex SOURCE (validated identically client + server)
  minLength?: number;
  maxLength?: number;
  message?: string; // shown when validation fails
}

export interface ConnectionField {
  name: string; // machine key, e.g. "api_key"
  label: string; // human label, e.g. "API key"
  type: ConnectionFieldType;
  secret: boolean; // true → stored in Vault, never returned to the client
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: ConnectionFieldOption[]; // for select / region
  validation?: ConnectionFieldValidation;
  autocomplete?: string; // "off" for sensitive credential inputs
  group?: string; // optional visual grouping, e.g. "SIP", "Webhook"
}

export interface OAuthRequirement {
  supported: boolean;
  pkce: boolean;
  scopes: string[];
  /** Non-secret key the server resolves to the provider authorize URL. Never a secret. */
  authorizeRefKey?: string;
  note?: string;
}

export interface WebhookRequirement {
  required: boolean;
  inbound: boolean; // provider posts events to us
  secretField?: string; // which declared field holds the webhook signing secret
  note?: string;
}

export interface IpAllowlistRequirement {
  required: boolean;
  addresses?: string[]; // our egress IPs the operator must allowlist at the provider
  note?: string;
}

export interface ConnectionSpec {
  provider: string;
  label: string;
  description: string;
  iconKey: string; // logo/icon key the UI maps to an asset (no binary here)
  regions: string[]; // supported regions (informational)
  authMode: AuthMode;
  fields: ConnectionField[]; // ordered; required + optional
  oauth?: OAuthRequirement;
  webhook?: WebhookRequirement;
  ipAllowlist?: IpAllowlistRequirement;
  accountRefField?: string; // which (non-secret) field is the masked account reference
  accountRefFormat?: string; // human hint for the account reference format
  helpText?: string; // connection-level guidance
  docsUrl?: string; // provider documentation reference
  manual: boolean; // true → provider-assisted / manual (not fully self-service)
  manualNote?: string; // honest explanation of the manual/provider-assisted limitation
}

/** Field names that are secret — the set the broker must route to Vault. */
export function secretFieldNames(spec: ConnectionSpec): string[] {
  return spec.fields.filter((f) => f.secret).map((f) => f.name);
}

/** Non-secret field names — safe to persist in provider_connections.non_secret_config. */
export function nonSecretFieldNames(spec: ConnectionSpec): string[] {
  return spec.fields.filter((f) => !f.secret).map((f) => f.name);
}

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Validate submitted values against a spec. Runs IDENTICALLY on the client (pre-submit UX)
 * and server (authoritative). `existingSecrets` names secret fields already stored, so a
 * required secret left blank on EDIT is OK (means "keep existing"); on first configure it
 * is an error. Never logs or echoes values.
 */
export function validateConnectionInput(
  spec: ConnectionSpec,
  values: Record<string, unknown>,
  existingSecrets: string[] = [],
): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of spec.fields) {
    const raw = values[f.name];
    const provided = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    const has = provided.length > 0;

    if (f.required && !has) {
      // A required secret already stored may be omitted to keep the current value.
      if (f.secret && existingSecrets.includes(f.name)) continue;
      errors.push({ field: f.name, message: `${f.label} is required` });
      continue;
    }
    if (!has) continue; // optional + empty → nothing to validate

    const v = f.validation;
    if (v) {
      if (typeof v.minLength === "number" && provided.length < v.minLength) {
        errors.push({ field: f.name, message: v.message ?? `${f.label} is too short` });
        continue;
      }
      if (typeof v.maxLength === "number" && provided.length > v.maxLength) {
        errors.push({ field: f.name, message: v.message ?? `${f.label} is too long` });
        continue;
      }
      if (v.pattern) {
        let re: RegExp | null = null;
        try {
          re = new RegExp(v.pattern);
        } catch {
          re = null;
        }
        if (re && !re.test(provided)) {
          errors.push({ field: f.name, message: v.message ?? `${f.label} is invalid` });
          continue;
        }
      }
    }
    if (f.type === "select" || f.type === "region") {
      const allowed = (f.options ?? []).map((o) => o.value);
      if (allowed.length && !allowed.includes(provided)) {
        errors.push({ field: f.name, message: `${f.label} must be one of the offered options` });
      }
    }
  }
  return errors;
}

/** Split submitted values into secret vs non-secret buckets per the spec. Pure. */
export function partitionValues(
  spec: ConnectionSpec,
  values: Record<string, unknown>,
): { secrets: Record<string, string>; nonSecret: Record<string, string> } {
  const secrets: Record<string, string> = {};
  const nonSecret: Record<string, string> = {};
  for (const f of spec.fields) {
    const raw = values[f.name];
    if (raw == null) continue;
    const s = typeof raw === "string" ? raw : String(raw);
    if (s.length === 0) continue;
    if (f.secret) secrets[f.name] = s;
    else nonSecret[f.name] = s;
  }
  return { secrets, nonSecret };
}

/**
 * Client-safe projection of a spec: strips nothing (specs carry no secrets) but guarantees a
 * stable shape the UI can render. Kept as a function so we can trim server-only hints later.
 */
export function publicSpec(spec: ConnectionSpec): ConnectionSpec {
  return spec;
}
