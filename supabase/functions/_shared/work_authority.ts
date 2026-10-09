import type { ActorAuthority } from "./work_transition.ts";
export function readWorkAuthority(
  data: unknown,
  scope: { tenantId: string; objectId: string; actorId: string; version: number },
): { actor: ActorAuthority; memberId: string | null; viaCover: boolean } {
  const value = data as Record<string, unknown>;
  if (
    !value ||
    value.contract !== "work-authority@1" ||
    value.tenantId !== scope.tenantId ||
    value.objectId !== scope.objectId ||
    value.actorId !== scope.actorId ||
    value.objectVersion !== scope.version ||
    ![
      "isAssignee",
      "isSuperadmin",
      "canAssign",
      "canApprove",
      "canConfirmOwnership",
      "canClaimUnassigned",
      "canAcceptAssigned",
      "viaCover",
      "directOwner",
    ].every((k) => typeof value[k] === "boolean") ||
    !(
      value.memberId === null ||
      (typeof value.memberId === "string" &&
        /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.memberId))
    ) ||
    value.isAssignee !== (value.directOwner || value.viaCover)
  )
    throw Error("Work authority response does not match this actor, item and revision");
  return {
    actor: {
      userRef: scope.actorId,
      isSuperadmin: value.isSuperadmin as boolean,
      isAssignee: value.isAssignee as boolean,
      canAssign: value.canAssign as boolean,
      canApprove: value.canApprove as boolean,
      canConfirmOwnership: value.canConfirmOwnership as boolean,
      canClaimUnassigned: value.canClaimUnassigned as boolean,
      canAcceptAssigned: value.canAcceptAssigned as boolean,
    },
    memberId: value.memberId as string | null,
    viaCover: value.viaCover as boolean,
  };
}
