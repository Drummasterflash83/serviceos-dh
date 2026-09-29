import { PracticeImprove, useEmmaInfo } from "@/components/receptionist/PracticeImprove";
import { useAuth } from "@/lib/auth";
import type { DeskIssue } from "@/lib/feedback-desk";
import "@/components/receptionist/receptionist.css";
export default function ApprovedVoiceRehearsal({ issue }: { issue: DeskIssue }) {
  const { user } = useAuth();
  const info = useEmmaInfo(issue.tenant_id, user?.id, false);
  return (
    <div className="rw rw-embedded">
      <div style={{ width: "100%" }}>
        <p className="fd-finding">
          Approved-version rehearsal only. This uses the original call’s transcribed welcome to
          recreate the scenario. Phone routing, business hours and the live assistant are unchanged.
          End the call, listen back, then save your test feedback for OpenFolk’s Slack.
        </p>
        <PracticeImprove
          tenant={issue.tenant_id}
          userId={user?.id}
          tester={user?.email ?? "OpenFolk"}
          name="Emma"
          demo={false}
          active={true}
          info={info}
          approvedTask={{ id: issue.id, version: issue.version }}
        />
      </div>
    </div>
  );
}
