export type SlackCredentialBinding =
  | { kind: "bot"; field: "bot_token"; userId: null; secretRef: string }
  | { kind: "user"; field: "user_token"; userId: string; secretRef: string };

/** Select only the explicitly configured credential. Legacy bot connections
 * remain supported; malformed or incomplete user configuration never falls back
 * to a bot credential. Keep the SQL broker's selector in parity with this rule. */
export function readSlackCredentialBinding(connection: {
  non_secret_config?: Record<string, unknown> | null;
  configured_fields?: unknown;
  secret_refs?: Record<string, unknown> | null;
}): SlackCredentialBinding | null {
  const config = connection.non_secret_config;
  if (!config || typeof config !== "object" || Array.isArray(config) || !Array.isArray(connection.configured_fields)) return null;
  const kind = Object.hasOwn(config, "credential_kind") ? config.credential_kind : "bot";
  if (kind !== "bot" && kind !== "user") return null;
  const userId = config.authorized_user_id;
  if (kind === "user" && (typeof userId !== "string" || !/^[UW][A-Z0-9]+$/.test(userId))) return null;
  if (kind === "bot" && Object.hasOwn(config, "authorized_user_id")) return null;
  const field = kind === "user" ? "user_token" : "bot_token";
  const secretRef = connection.secret_refs?.[field];
  if (!connection.configured_fields.includes(field) || typeof secretRef !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(secretRef)) return null;
  return kind === "user"
    ? { kind, field: "user_token", userId: userId as string, secretRef }
    : { kind, field: "bot_token", userId: null, secretRef };
}
