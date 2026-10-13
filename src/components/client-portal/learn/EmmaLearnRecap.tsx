import { PracticeImprove, useEmmaInfo } from "@/components/receptionist/PracticeImprove";
import "@/components/receptionist/receptionist.css";
export function EmmaLearnRecap({
  tenantId,
  userId,
  tester,
}: {
  tenantId: string;
  userId: string;
  tester: string;
}) {
  const info = useEmmaInfo(tenantId, userId, false, true, true);
  return (
    <PracticeImprove
      tenant={tenantId}
      userId={userId}
      tester={tester}
      name="Emma"
      demo={false}
      active
      info={info}
      recap
    />
  );
}
