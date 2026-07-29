/**
 * Marketing segments client — versioned dynamic segments through the
 * `marketing-segments` Edge Function. Definitions are a constrained,
 * server-validated filter AST (never raw SQL); evaluation is fully server-side.
 */
import { callMarketingFn } from "./call";

/** Constrained filter AST (validated authoritatively in the database). */
export type SegmentNode =
  | { op: "and" | "or"; children: SegmentNode[] }
  | { op: "not"; child: SegmentNode }
  | { field: "search"; value: string }
  | {
      field: "relationship";
      match: {
        lifecycle?: string;
        type?: string;
        status?: "active" | "inactive" | "archived";
        source?: string;
        owner_id?: string; // uuid or 'unassigned'
      };
    }
  | { field: "company"; value: string | null }
  | { field: "created"; from?: string; to?: string }
  | { field: "last_contact"; from?: string; to?: string; never?: boolean }
  | { field: "tag"; mode: "any" | "all" | "none"; tag_ids: string[] }
  | { field: "eligibility"; channel: "email" | "phone"; value: string };

export interface MarketingSegment {
  id: string;
  name: string;
  description: string | null;
  definition: SegmentNode;
  definition_version: number;
  status: "active" | "archived";
  estimated_count: number | null;
  evaluated_at: string | null;
  updated_at: string;
}

export interface SegmentEvaluation {
  count: number;
  items: {
    person_id: string;
    display_name: string | null;
    primary_email: string | null;
    primary_phone: string | null;
    created_at: string;
  }[];
  /** Strict typed keyset cursor for the next page (null on the last page). */
  next_cursor: { v: string; id: string } | null;
  /** The ACTUAL stored evaluation timestamp — null when nothing was stored
   *  (ad-hoc definitions, or the segment changed during evaluation). */
  evaluated_at: string | null;
  /** The definition version the evaluation ran against (saved segments). */
  segment_version?: number;
  stored: boolean;
}

export const listSegments = () =>
  callMarketingFn<{ segments: MarketingSegment[] }>("marketing-segments", { action: "list" });

export const createSegment = (args: {
  name: string;
  description?: string;
  definition: SegmentNode;
}) => callMarketingFn<MarketingSegment>("marketing-segments", { action: "create", args });

export const updateSegment = (args: {
  segment_id: string;
  expected_version: number;
  name?: string;
  description?: string;
  definition?: SegmentNode;
}) => callMarketingFn<MarketingSegment>("marketing-segments", { action: "update", args });

export const setSegmentStatus = (
  op: "archive" | "reactivate",
  segmentId: string,
  expectedUpdatedAt: string,
) =>
  callMarketingFn<MarketingSegment>("marketing-segments", {
    action: op,
    args: { segment_id: segmentId, expected_updated_at: expectedUpdatedAt },
  });

export const evaluateSegment = (args: {
  segment_id?: string;
  definition?: SegmentNode;
  limit?: number;
  cursor?: { v: string; id: string } | null;
  /** Pin the definition version being evaluated (stale → VERSION_CONFLICT). */
  expected_version?: number;
}) => callMarketingFn<SegmentEvaluation>("marketing-segments", { action: "evaluate", ...args });
