#!/usr/bin/env bash
# ServiceOS — OpenFolk Control Plane: grant the FIRST platform operator authority.
#
# Platform authority is deliberately NOT seeded into any universal migration (no
# personal email/profile in shared SQL). An operator runs this out-of-band to grant the
# initial platform.controlplane.view / .admin. It records the granting actor, reason,
# effective start and provenance in platform_authority_grants.
#
# The target profile must already exist (the operator has signed in at least once) and
# have role='openfolk' — this script does NOT elevate a profile's role.
#
# Usage:
#   scripts/openfolk-grant-operator.sh \
#     --email operator@openfolk.example \
#     --permission admin|view \
#     --granted-by "your-name-or-email" \
#     --reason "onboarding first OpenFolk operator" \
#     [--local | --db-url "postgres://…"]     # default: local Docker stack
#
# PRODUCTION: pass --db-url with the prod connection string. This script is the
# operator's pipeline; it is intentionally not run automatically and never against prod
# without an explicit, human-initiated invocation.
set -euo pipefail

EMAIL=""; PERM=""; GRANTED_BY=""; REASON=""; TARGET="local"; DBURL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="$2"; shift 2;;
    --permission) PERM="$2"; shift 2;;
    --granted-by) GRANTED_BY="$2"; shift 2;;
    --reason) REASON="$2"; shift 2;;
    --local) TARGET="local"; shift;;
    --db-url) TARGET="url"; DBURL="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$EMAIL" ] && [ -n "$PERM" ] && [ -n "$GRANTED_BY" ] && [ -n "$REASON" ] || {
  echo "required: --email --permission --granted-by --reason" >&2; exit 2; }
case "$PERM" in view) PERMISSION="platform.controlplane.view";; admin) PERMISSION="platform.controlplane.admin";;
  *) echo "--permission must be 'view' or 'admin'" >&2; exit 2;; esac

# Parameterised SQL (values passed as psql variables, never interpolated into SQL text).
SQL=$(cat <<'EOSQL'
\set ON_ERROR_STOP on
do $$
declare v_pid uuid; v_role text;
begin
  select id, role into v_pid, v_role from public.profiles where email = :'email';
  if v_pid is null then
    raise exception 'No profile for % — the operator must sign in once before being granted.', :'email';
  end if;
  if v_role is distinct from 'openfolk' then
    raise exception 'Profile % has role % (must be openfolk). Set the role first (not done by this script).', :'email', coalesce(v_role,'<null>');
  end if;
  -- Idempotent: reactivate/keep one active grant of this permission.
  if exists (select 1 from public.platform_authority_grants
              where profile_id = v_pid and permission = :'perm' and effective_to is null) then
    raise notice 'Active % grant already exists for % — no change.', :'perm', :'email';
  else
    insert into public.platform_authority_grants
      (profile_id, permission, granted_by, reason, effective_from, source)
    values (v_pid, :'perm', :'granted_by', :'reason', now(), 'openfolk-grant-operator.sh');
    raise notice 'Granted % to % (by %, reason: %).', :'perm', :'email', :'granted_by', :'reason';
  end if;
end $$;
EOSQL
)

run_psql() { # <psql-invocation...>
  "$@" -v email="$EMAIL" -v perm="$PERMISSION" -v granted_by="$GRANTED_BY" -v reason="$REASON" <<< "$SQL"
}

echo "── Granting $PERMISSION to $EMAIL (by $GRANTED_BY) ──"
if [ "$TARGET" = "local" ]; then
  run_psql docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres
else
  run_psql psql "$DBURL"
fi
echo "Done."
