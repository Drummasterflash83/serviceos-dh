import { readOperatorInventory } from "./inventory.ts";
export async function loadRoster(
  db: { from(table: string): any },
  tenantId: string,
  now = Date.now(),
) {
  if (
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(tenantId) ||
    !Number.isFinite(now) ||
    Math.abs(now) > 8.64e15
  )
    throw new Error("Invalid roster scope");
  const cutoff = new Date(now).toISOString();
  const read = (table: string, columns: string, order: string, openOnly = false) =>
    readOperatorInventory(db, tenantId, table, columns, {
      label: "roster",
      order,
      filter: openOnly ? (q) => q.or(`effective_to.is.null,effective_to.gt.${cutoff}`) : undefined,
    });
  const [members, responsibilities, authorityGrants] = await Promise.all([
    read(
      "team_members",
      "id,display_name,formal_role,formal_role_status,target_role,observed_role,observed_status,authority_level,org_unit_id,profile_id,effective_from,effective_to",
      "display_name",
    ),
    read(
      "responsibility_assignments",
      "id,member_id,kind,target_ref,label,raci_role,is_shared,weekday_mask,cover_for,confirmed,effective_from,effective_to,version",
      "label",
      true,
    ),
    read(
      "authority_grants",
      "id,member_id,permission,scope,scope_ref,confirmed,effective_from,effective_to",
      "permission",
      true,
    ),
  ]);
  return { members, responsibilities, authorityGrants };
}
