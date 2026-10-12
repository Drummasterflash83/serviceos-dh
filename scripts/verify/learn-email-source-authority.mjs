/** A later successful verification does not change the pinned mailbox authority. */
export function matchesEmailSourceAuthority(prepared, current) {
  if (!prepared || !current) return false;
  const keys = Object.keys(prepared).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(current).sort())) return false;
  const before = Date.parse(prepared.last_verified_at);
  const after = Date.parse(current.last_verified_at);
  if (!Number.isFinite(before) || !Number.isFinite(after) || after < before) return false;
  return keys.every(key => key === 'last_verified_at' ||
    JSON.stringify(prepared[key]) === JSON.stringify(current[key]));
}
