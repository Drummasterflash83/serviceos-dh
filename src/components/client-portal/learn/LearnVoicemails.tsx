import { lazy, Suspense, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/receptionist/receptionist.css";

const VoicemailInbox = lazy(() => import("@/components/receptionist/VoicemailInbox"));

/** Private sources stay in their owner/manager reader, outside shared customer cards. */
export function LearnVoicemails({ tenantId, actorId }: { tenantId: string; actorId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="cp-card">
      <h2>Private voicemail</h2>
      <p>
        Review saved messages and available audio from mailboxes you own or are authorised to
        manage.
      </p>
      <button className="cp-secondary" disabled={!actorId} onClick={() => setOpen(true)}>
        Open private voicemail
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          overlayClassName="z-[90]"
          className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle>Private voicemail</DialogTitle>
            <DialogDescription>
              These messages keep their mailbox permissions. They are not shared through customer
              cards or used to score staff.
            </DialogDescription>
          </DialogHeader>
          {open && actorId && (
            <div className="rw rw-embedded">
              <Suspense fallback={<p role="status">Opening your private inbox…</p>}>
                <VoicemailInbox key={`${tenantId}:${actorId}`} tenant={tenantId} userId={actorId} />
              </Suspense>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
