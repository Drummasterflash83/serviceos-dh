import { useState } from "react";
import { OpenfolkRoster, type RosterActions } from "../../src/components/app/OpenfolkRoster";
import type { Workspace } from "../../src/lib/openfolk";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const initial: Workspace = {
  summary: {
    tenant_id: id(1),
    slug: "synthetic",
    display_name: "Synthetic company",
    people: 1,
    endpoints_total: 0,
    endpoints_unmapped: 0,
    identities_unverified: 0,
    ambiguous_assignments: 0,
  },
  members: [
    {
      id: id(2),
      display_name: "Example coordinator",
      formal_role: "Coordinator",
      formal_role_status: "proposed",
      target_role: "Office manager",
      authority_level: "individual",
      org_unit_id: id(3),
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: null,
    },
  ],
  responsibilities: [
    {
      id: id(4),
      member_id: id(2),
      kind: "workflow",
      target_ref: null,
      label: "Service appointment queue",
      raci_role: "responsible",
      is_shared: true,
      weekday_mask: 31,
      cover_for: null,
      confirmed: false,
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: null,
      version: 1,
    },
  ],
  authorityGrants: [
    {
      id: id(5),
      member_id: id(2),
      permission: "work.assign",
      scope: "team",
      scope_ref: id(3),
      confirmed: false,
      effective_from: "2026-01-01T00:00:00Z",
    },
  ],
  identities: [],
  endpoints: [],
  ownership: [],
  dataQuality: [],
};
export function RosterReview() {
  const [workspace, setWorkspace] = useState(initial);
  const [notice, setNotice] = useState(
    "Synthetic local review. Changes exist in memory only; no real staff or permissions are changed.",
  );
  const changed = (message: string, update: (w: Workspace) => Workspace) => {
    setWorkspace(update);
    setNotice(message + " · synthetic only");
    return Promise.resolve(true);
  };
  const actions: RosterActions = {
    memberUpsert: (p) =>
      changed(p.reason, (w) => ({
        ...w,
        members: p.member_id
          ? w.members.map((m) => (m.id === p.member_id ? { ...m, ...p } : m))
          : [
              ...w.members,
              {
                id: crypto.randomUUID(),
                display_name: p.display_name!,
                formal_role: p.formal_role ?? null,
                formal_role_status: p.formal_role_status ?? "proposed",
                target_role: p.target_role,
                authority_level: p.authority_level,
                org_unit_id: null,
                effective_from: new Date().toISOString(),
                effective_to: null,
              },
            ],
      })),
    memberLifecycle: (p) =>
      changed(p.reason, (w) => ({
        ...w,
        members: w.members.map((m) =>
          m.id === p.member_id
            ? {
                ...m,
                effective_to: p.op === "end" ? new Date().toISOString() : null,
                effective_from: p.op === "reactivate" ? new Date().toISOString() : m.effective_from,
              }
            : m,
        ),
        responsibilities: w.responsibilities?.filter((r) => r.member_id !== p.member_id),
        authorityGrants: w.authorityGrants?.filter((g) => g.member_id !== p.member_id),
      })),
    responsibilityUpsert: (p) =>
      changed(p.reason, (w) => ({
        ...w,
        responsibilities: p.assignment_id
          ? w.responsibilities?.map((r) =>
              r.id === p.assignment_id
                ? { ...r, confirmed: p.confirmed ?? r.confirmed, version: r.version + 1 }
                : r,
            )
          : [
              ...(w.responsibilities ?? []),
              {
                id: crypto.randomUUID(),
                member_id: p.member_id!,
                kind: p.kind!,
                target_ref: null,
                label: p.label!,
                raci_role: p.raci_role ?? "responsible",
                is_shared: p.is_shared ?? false,
                weekday_mask: p.weekday_mask ?? null,
                cover_for: p.cover_for ?? null,
                confirmed: false,
                effective_from: new Date().toISOString(),
                effective_to: null,
                version: 1,
              },
            ],
      })),
    responsibilityEnd: (p) =>
      changed(p.reason, (w) => ({
        ...w,
        responsibilities: w.responsibilities?.filter((r) => r.id !== p.assignment_id),
      })),
    authorityGrant: (p) =>
      changed(p.reason, (w) => {
        const found = w.authorityGrants?.find(
          (g) =>
            g.member_id === p.member_id &&
            g.permission === p.permission &&
            g.scope === p.scope &&
            g.scope_ref === (p.scope_ref ?? null),
        );
        return {
          ...w,
          authorityGrants: found
            ? w.authorityGrants?.map((g) =>
                g === found ? { ...g, confirmed: p.confirmed ?? g.confirmed } : g,
              )
            : [
                ...(w.authorityGrants ?? []),
                {
                  id: crypto.randomUUID(),
                  member_id: p.member_id,
                  permission: p.permission,
                  scope: p.scope ?? "self",
                  scope_ref: p.scope_ref ?? null,
                  confirmed: false,
                  effective_from: new Date().toISOString(),
                },
              ],
        };
      }),
    authorityEnd: (p) =>
      changed(p.reason, (w) => ({
        ...w,
        authorityGrants: w.authorityGrants?.filter((g) => g.id !== p.grant_id),
      })),
  };
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-3 text-2xl">Recovered team roster</h1>
      <p role="status" className="mb-4 rounded border p-3 text-sm">
        {notice}
      </p>
      <OpenfolkRoster
        workspace={workspace}
        writeCapable
        busy={false}
        actions={actions}
        onPreview={() =>
          setNotice(
            "Command Centre navigation belongs to the full application; this fixture reviews the roster only.",
          )
        }
        onOpenHub={() =>
          setNotice(
            "Person hub navigation belongs to the full application; this fixture reviews the roster only.",
          )
        }
      />
    </main>
  );
}
