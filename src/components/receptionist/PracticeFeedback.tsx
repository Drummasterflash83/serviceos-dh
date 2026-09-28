import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { PracticeFeedbackDraft, type PracticeDraft } from "@/lib/practice-feedback-draft";

export type PracticeFeedbackHandle = { complete: () => Promise<string | null> };

export function SavedPracticeFeedback({
  sessionId,
  userId,
  tenant,
  active,
}: {
  sessionId: string;
  userId: string;
  tenant: string;
  active: boolean;
}) {
  const handle = useRef<PracticeFeedbackHandle | null>(null);
  const queries = useQueryClient();
  return (
    <PracticeFeedback
      sessionId={sessionId}
      userId={userId}
      tenant={tenant}
      active={active}
      handle={handle}
      onSaved={() => {
        void queries.invalidateQueries({
          predicate: (q) => String(q.queryKey[0]).startsWith("receptionist-"),
        });
      }}
    />
  );
}

export function PracticeFeedback({
  sessionId,
  userId,
  tenant,
  active,
  handle,
  onSaved,
}: {
  sessionId: string;
  userId: string;
  tenant: string;
  active: boolean;
  handle: MutableRefObject<PracticeFeedbackHandle | null>;
  onSaved: (id: string) => void;
}) {
  const [body, setBody] = useState("");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("Loading your feedback draft…");
  const [error, setError] = useState("");
  const controller = useRef<PracticeFeedbackDraft | null>(null);
  const alive = useRef(true);
  const onSavedRef = useRef(onSaved);
  const notified = useRef(false);
  onSavedRef.current = onSaved;

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    const db = getSupabaseClient();
    void (async () => {
      const existing = await db
        .from("receptionist_practice_drafts")
        .select("id,body,version")
        .eq("session_id", sessionId)
        .eq("author_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (existing.error) {
        setError("Your feedback draft could not be checked. Reopen this test before typing.");
        return;
      }
      const initial = (existing.data as PracticeDraft | null) ?? {
        id: crypto.randomUUID(),
        body: "",
        version: 0,
      };
      const draft = new PracticeFeedbackDraft(initial, {
        save: async (next) => {
          const result = await db.rpc("save_receptionist_practice_draft", {
            p_session: sessionId,
            p_submission: next.id,
            p_version: next.version,
            p_body: next.body,
          });
          if (result.error)
            throw Error(
              "Draft save not confirmed. Keep this page open and retry; another window may have changed it.",
            );
          return result.data as PracticeDraft;
        },
        complete: async (next) => {
          const result = await db.rpc("complete_receptionist_practice_draft", {
            p_session: sessionId,
            p_submission: next.id,
            p_version: next.version,
          });
          if (result.error)
            throw Error(
              "Your report is not yet confirmed. Any saved draft remains with this test; retry before leaving.",
            );
          return result.data as string | null;
        },
      });
      controller.current = draft;
      handle.current = {
        complete: async () => {
          const id = await draft.complete();
          if (id && !notified.current) {
            notified.current = true;
            onSavedRef.current(id);
            if (alive.current) {
              setSaved(true);
              setStatus("Feedback saved to OpenFolk with this call.");
              setError("");
            }
          }
          return id;
        },
      };
      setBody(initial.body);
      setReady(true);
      setStatus(
        initial.version
          ? "Draft saved with this test."
          : "Your test call is already saved. Add feedback when you're ready.",
      );
    })().catch(() => {
      if (!cancelled) setError("Your feedback draft is unavailable. Reopen this test to retry.");
    });
    return () => {
      cancelled = true;
      alive.current = false;
      const current = handle.current;
      handle.current = null;
      // In-app navigation normally waits below. On unmount this is best effort;
      // already acknowledged drafts remain durable if the browser terminates.
      void current?.complete().catch(() => undefined);
    };
  }, [sessionId, userId, tenant, handle]);

  useEffect(() => {
    if (!ready || saved || !controller.current?.dirty) return;
    const timeout = setTimeout(() => {
      setStatus("Saving your draft…");
      void controller.current
        ?.persist()
        .then(() => {
          if (alive.current) {
            setStatus(
              controller.current?.dirty
                ? "Saving your latest changes…"
                : "Draft saved with this test.",
            );
            setError("");
          }
        })
        .catch((e: Error) => {
          if (alive.current) {
            setStatus("Draft save not confirmed.");
            setError(e.message);
          }
        });
    }, 600);
    return () => clearTimeout(timeout);
  }, [body, ready, saved]);

  useEffect(() => {
    if (!active && ready)
      void handle.current?.complete().catch((e: Error) => {
        if (alive.current) setError(e.message);
      });
  }, [active, ready, handle]);

  return (
    <form
      className="ep-inline-feedback"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || sending || saved) return;
        setSending(true);
        void handle.current
          ?.complete()
          .catch((e: Error) => setError(e.message))
          .finally(() => setSending(false));
      }}
    >
      <label htmlFor={`emma-test-feedback-${sessionId}`}>What should Emma do differently?</label>
      <textarea
        id={`emma-test-feedback-${sessionId}`}
        value={body}
        maxLength={3500}
        disabled={!ready || sending || saved}
        onChange={(e) => {
          controller.current?.edit(e.target.value);
          setBody(e.target.value);
          setStatus("Changes not yet saved…");
        }}
        placeholder="Tell OpenFolk what happened or what you want changed."
      />
      {!saved && (
        <button className="rw-btn rw-btn-primary" disabled={!ready || sending || !body.trim()}>
          <Send size={17} /> {sending ? "Saving…" : "Save feedback"}
        </button>
      )}
      <small role="status">{status}</small>
      {error && <p role="alert">{error}</p>}
      <small>
        Feedback is saved with the test and sent to OpenFolk when you save or leave this page. It
        does not change Emma automatically.
      </small>
    </form>
  );
}
