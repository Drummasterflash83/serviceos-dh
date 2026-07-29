/**
 * Marketing administration client (owner/admin surface) — settings, lifecycle
 * stages, access grants and the Marketing audit view, all through the
 * `marketing-admin` Edge Function. Stable error codes: INVALID_REQUEST /
 * NOT_FOUND / FORBIDDEN / VERSION_CONFLICT / LOCKOUT / DUPLICATE / INTERNAL.
 */
import { callMarketingFn } from "./call";

export interface MarketingSettingsFull extends Record<string, unknown> {
  id: string;
  marketing_enabled: boolean;
  include_all_discovered: boolean;
  default_relationship_type: string;
  default_lifecycle_stage_key: string;
  timezone: string;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  tracking_enabled: boolean;
  reply_handling: "workspace" | "none";
  unsubscribe_footer: Record<string, string | null>;
  notification_routing: Record<string, string>;
  settings: { guardrails?: { max_bulk_recipients?: number; require_unsubscribe_footer?: boolean } };
  version: number;
  updated_at: string;
}

export interface LifecycleStageAdmin {
  id: string;
  stage_key: string;
  label: string;
  tone: string;
  sort_order: number;
  active: boolean;
  terminal_outcome: "won" | "lost" | "nurture" | null;
  is_default: boolean;
  updated_at: string;
}

export interface AccessOverview {
  users: {
    id: string;
    full_name: string | null;
    email: string | null;
    role: string;
    effective: string[];
    grants: { permission: string; granted: boolean; updated_at: string }[];
  }[];
  role_defaults: Record<string, string[]>;
  permissions: {
    permission: string;
    category: string;
    description: string;
    restricted: boolean;
  }[];
}

export interface MarketingAuditRow {
  id: string;
  actor: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  status: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export const getMarketingSettings = () =>
  callMarketingFn<{ settings: MarketingSettingsFull | null }>("marketing-admin", {
    action: "settings_get",
  });

export const updateMarketingSettings = (
  changes: Record<string, unknown>,
  expectedVersion: number,
) =>
  callMarketingFn<{ version: number; settings: MarketingSettingsFull; changed: string[] }>(
    "marketing-admin",
    { action: "settings_update", changes, expected_version: expectedVersion },
  );

export const listSettingsHistory = () =>
  callMarketingFn<{
    history: {
      id: string;
      version: number;
      snapshot: Record<string, unknown>;
      changed: string[];
      created_at: string;
    }[];
  }>("marketing-admin", { action: "history_list" });

export const listLifecycleStagesAdmin = () =>
  callMarketingFn<{ stages: LifecycleStageAdmin[] }>("marketing-admin", {
    action: "lifecycle_list",
  });

export const lifecycleAdmin = (op: string, args: Record<string, unknown>) =>
  callMarketingFn<{
    op: string;
    stage: LifecycleStageAdmin | null;
    remapped_active_relationships: number | null;
    /** retire_preview: CURRENT ACTIVE relationships that would be remapped. */
    active_in_use?: number;
    /** retire_preview: historical (inactive/archived) rows that KEEP the
     *  retired stage key — never remapped. */
    historical_relationships?: number;
    is_default?: boolean;
  }>("marketing-admin", { action: "lifecycle", op, args });

export const getAccessOverview = () =>
  callMarketingFn<AccessOverview>("marketing-admin", { action: "access_overview" });

export const setAccessGrant = (
  profileId: string,
  permission: string,
  mode: "grant" | "deny" | "clear",
  expected: "granted" | "denied" | "none",
) =>
  callMarketingFn<{ profile_id: string; permission: string; state: string; effective: string[] }>(
    "marketing-admin",
    { action: "access_set", profile_id: profileId, permission, mode, expected },
  );

export const listMarketingAudit = (args: {
  limit?: number;
  action_prefix?: string;
  /** TRUE keyset cursor: the exact (created_at, id) tuple of the last row. */
  cursor?: { t: string; id: string } | null;
}) =>
  callMarketingFn<{ items: MarketingAuditRow[]; next_cursor: { t: string; id: string } | null }>(
    "marketing-admin",
    { action: "audit_list", ...args },
  );
