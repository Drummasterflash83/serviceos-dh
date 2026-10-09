/** The operator must never see a failed/truncated roster read as an empty team. */
export async function loadRoster(
  db: { from(table: string): any },
  tenantId: string,
  now = Date.now(),
) {
  const read = async (table: string, columns: string, order: string, openOnly = false) => {
    let query = db
      .from(table)
      .select(`tenant_id,${columns}`, { count: "exact" })
      .eq("tenant_id", tenantId);
    if (openOnly)
      query = query.or(`effective_to.is.null,effective_to.gt.${new Date(now).toISOString()}`);
    const { data, count, error } = await query.order(order).limit(2001);
    if (
      error ||
      !Array.isArray(data) ||
      !Number.isSafeInteger(count) ||
      count > 2000 ||
      count !== data.length ||
      data.some((r: any) => !r || r.tenant_id !== tenantId || typeof r.id !== "string") ||
      new Set(data.map((r: any) => r.id)).size !== data.length
    ) {
      throw new Error(`Complete roster data could not be read (${table})`);
    }
    return data;
  };
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
