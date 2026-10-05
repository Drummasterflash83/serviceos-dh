// ServiceOS — Slack ADAPTER: users.list normalisation (PURE, provider-flavoured).
//
// EVIDENCE SOURCE, not canonical logic. Understands Slack's `users.list` member shape and
// normalises it into a provider-neutral tuple the identity engine consumes. Slack field names
// (`is_bot`, `profile.display_name`, `deleted`, …) live ONLY here — swapping providers means a
// new adapter, nothing downstream. Bots/apps/system users are CLASSIFIED (never dropped
// silently) so the canonical layer can refuse to suggest them as people.
//
// Read-only: this module parses records the caller fetched; it never calls Slack and holds no
// tokens. Identity discovery needs NO message scopes — only the user directory.

/** A raw Slack `users.list` member (only the fields we read; Slack sends more). */
export interface RawSlackUser {
  id?: string;
  team_id?: string;
  name?: string; // handle
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  is_restricted?: boolean; // guest
  is_ultra_restricted?: boolean; // single-channel guest
  is_email_confirmed?: boolean;
  tz?: string;
  profile?: {
    real_name?: string;
    display_name?: string;
    email?: string;
    title?: string;
    image_72?: string;
    bot_id?: string;
  };
}

export type SlackClassification = "person" | "bot" | "app" | "system";

export interface NormalizedSlackUser {
  slack_user_id: string;
  team_id: string | null;
  handle: string | null;
  display_name: string | null;
  real_name: string | null;
  email: string | null;
  email_confirmed: boolean;
  title: string | null;
  tz: string | null;
  deactivated: boolean;
  is_guest: boolean;
  image_ref: string | null;
  classification: SlackClassification;
}

/** Slackbot has a fixed id. Treated as a system user, never a person. */
const SLACKBOT_ID = "USLACKBOT";

/** Classify a raw member. Bots/apps/system are NEVER people (the canonical layer refuses them). */
export function classifySlackUser(raw: RawSlackUser): SlackClassification {
  if ((raw.id ?? "") === SLACKBOT_ID) return "system";
  if (raw.is_bot === true || raw.profile?.bot_id) return "bot";
  if (raw.is_app_user === true) return "app";
  return "person";
}

/** Normalise a raw Slack user into a provider-neutral tuple. Pure + deterministic. */
export function normalizeSlackUser(raw: RawSlackUser): NormalizedSlackUser | null {
  const id = (raw.id ?? "").trim();
  if (!id) return null; // an unusable record — not a candidate
  const p = raw.profile ?? {};
  const email = (p.email ?? "").trim().toLowerCase() || null;
  return {
    slack_user_id: id,
    team_id: (raw.team_id ?? "").trim() || null,
    handle: (raw.name ?? "").trim() || null,
    display_name: (p.display_name ?? "").trim() || null,
    real_name: (p.real_name ?? raw.real_name ?? "").trim() || null,
    email,
    email_confirmed: raw.is_email_confirmed === true,
    title: (p.title ?? "").trim() || null,
    tz: (raw.tz ?? "").trim() || null,
    deactivated: raw.deleted === true,
    is_guest: raw.is_restricted === true || raw.is_ultra_restricted === true,
    image_ref: (p.image_72 ?? "").trim() || null,
    classification: classifySlackUser(raw),
  };
}

/** Normalise a whole directory, dropping only structurally-unusable rows (no id). */
export function normalizeSlackDirectory(raws: RawSlackUser[]): NormalizedSlackUser[] {
  const out: NormalizedSlackUser[] = [];
  for (const r of raws ?? []) {
    const n = normalizeSlackUser(r);
    if (n) out.push(n);
  }
  return out;
}
