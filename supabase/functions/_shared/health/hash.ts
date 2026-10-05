// ServiceOS — deterministic, dependency-free hashing for Health evaluation identity.
//
// The append-only health_assessments idempotency index keys on
// (tenant_id, health_object_id, input_hash). This module derives that input_hash in
// TypeScript (never in SQL), so a retry with identical inputs collapses to one
// snapshot and a changed input yields a new one. Pure and replayable — no clock,
// no randomness. Mirrors the objectives engine's buildObjectiveInputHash intent.

/** Canonical JSON with sorted object keys, so key ORDER never affects the hash. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

/** FNV-1a 32-bit over a string → 8 hex chars. */
function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A wide (128-bit) deterministic hash as 32 hex chars. Two independently-seeded
 * FNV passes over the canonical string plus its reverse make collisions
 * astronomically unlikely for evaluation-identity use.
 */
export function stableHash(value: unknown): string {
  const s = stableStringify(value);
  const r = s.split("").reverse().join("");
  const a = fnv1a(s, 0x811c9dc5);
  const b = fnv1a(r, 0x811c9dc5);
  const c = fnv1a(s, 0x9e3779b1);
  const d = fnv1a(r, 0x85ebca77);
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return hex(a) + hex(b) + hex(c) + hex(d);
}

export const HEALTH_EVALUATOR_VERSION = "customer-health@1";
export const CALLBACK_CLASSIFIER_VERSION = "callback-classifier@1";
