/** Durable completion around the page engine. Registration awaits real credential
 * ports, recurring scheduling/controller integration and hosted acceptance. */
import { uuid, object } from "./microsoft_graph_transport.ts";
import {
  runMicrosoftCapturePage,
  MicrosoftJournalError,
  type MicrosoftJournalDb,
  type MicrosoftCaptureClaim,
  type MicrosoftCapturePorts,
} from "./microsoft_capture_engine.ts";
export type MicrosoftFolderDispatch = {
  physicalFolders: number;
  searchFolders: number;
  newJobs: number;
  reusedJobs: number;
  previouslyDispatched: number;
};
export type MicrosoftJobCompletion = {
  contract: "microsoft-job-settlement/1";
  state: "completed";
  tenantId: string;
  jobId: string;
  sourceReceiptId: string | null;
  successorId: string | null;
  observationsStored: number;
  mailboxCoverage: "unverified";
  folderDispatch?: MicrosoftFolderDispatch | null;
  /** Omitted by historical receipts; never inferred for old completions. */
  continuationKind?: "page" | "incremental" | null;
  nextCheckAt?: string | null;
};
export async function runMicrosoftCaptureJob(
  db: MicrosoftJournalDb,
  input: MicrosoftCaptureClaim,
  ports: MicrosoftCapturePorts,
): Promise<MicrosoftJobCompletion> {
  if (
    !input ||
    ![input.tenantId, input.jobId].every(uuid) ||
    typeof input.claimedBy !== "string" ||
    !input.claimedBy ||
    input.claimedBy.length > 256 ||
    !Number.isSafeInteger(input.attemptCount) ||
    input.attemptCount < 1
  )
    throw new MicrosoftJournalError("invalid_job");
  const claim = structuredClone(input);
  async function settle(apply: boolean): Promise<MicrosoftJobCompletion | null> {
    try {
      const { data, error } = await db.rpc("learn_microsoft_job_settle", {
        p_tenant: claim.tenantId,
        p_job: claim.jobId,
        p_worker: claim.claimedBy,
        p_claim: claim.attemptCount,
        p_apply: apply,
      });
      if (
        error ||
        !object(data) ||
        data.contract !== "microsoft-job-settlement/1" ||
        data.tenantId !== claim.tenantId ||
        data.jobId !== claim.jobId
      )
        throw Error();
      if (data.state === "pending" && !apply) return null;
      if (
        data.state !== "completed" ||
        (data.sourceReceiptId !== null && !uuid(data.sourceReceiptId)) ||
        (data.successorId !== null && !uuid(data.successorId)) ||
        data.successorId === claim.jobId ||
        !Number.isSafeInteger(data.observationsStored) ||
        data.observationsStored < 0 ||
        data.observationsStored > 1000 ||
        data.mailboxCoverage !== "unverified" ||
        (data.sourceReceiptId === null &&
          (data.observationsStored !== 0 || data.successorId !== null))
      )
        throw Error();
      const hasDispatch = Object.hasOwn(data, "folderDispatch");
      const hasSchedule = Object.hasOwn(data, "continuationKind");
      if (
        hasSchedule !== Object.hasOwn(data, "nextCheckAt") ||
        (hasSchedule &&
          (data.continuationKind === null
            ? data.nextCheckAt !== null || data.successorId !== null
            : !["page", "incremental"].includes(data.continuationKind) ||
              data.sourceReceiptId === null ||
              data.successorId === null ||
              typeof data.nextCheckAt !== "string" ||
              !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(
                data.nextCheckAt,
              ) ||
              !Number.isFinite(Date.parse(data.nextCheckAt))))
      )
        throw Error();
      const dispatch = data.folderDispatch;
      if (hasDispatch && dispatch !== null) {
        const keys = [
          "physicalFolders",
          "searchFolders",
          "newJobs",
          "reusedJobs",
          "previouslyDispatched",
        ];
        if (
          !object(dispatch) ||
          Object.keys(dispatch).length !== keys.length ||
          !keys.every(
            (k) => Number.isSafeInteger(dispatch[k]) && dispatch[k] >= 0 && dispatch[k] <= 1000,
          ) ||
          data.sourceReceiptId === null ||
          dispatch.physicalFolders + dispatch.searchFolders > data.observationsStored ||
          dispatch.newJobs + dispatch.reusedJobs > dispatch.physicalFolders ||
          dispatch.newJobs + dispatch.reusedJobs + dispatch.previouslyDispatched >
            dispatch.physicalFolders + dispatch.searchFolders ||
          dispatch.physicalFolders - dispatch.newJobs - dispatch.reusedJobs >
            dispatch.previouslyDispatched
        )
          throw Error();
      }
      return {
        contract: data.contract,
        state: "completed",
        tenantId: data.tenantId,
        jobId: data.jobId,
        sourceReceiptId: data.sourceReceiptId,
        successorId: data.successorId,
        observationsStored: data.observationsStored,
        mailboxCoverage: "unverified",
        ...(hasSchedule
          ? { continuationKind: data.continuationKind, nextCheckAt: data.nextCheckAt }
          : {}),
        ...(hasDispatch
          ? {
              folderDispatch:
                dispatch === null
                  ? null
                  : {
                      physicalFolders: dispatch.physicalFolders,
                      searchFolders: dispatch.searchFolders,
                      newJobs: dispatch.newJobs,
                      reusedJobs: dispatch.reusedJobs,
                      previouslyDispatched: dispatch.previouslyDispatched,
                    },
            }
          : {}),
      };
    } catch {
      throw new MicrosoftJournalError("settlement_unconfirmed");
    }
  }
  const prior = await settle(false);
  if (prior) return prior;
  const page = await runMicrosoftCapturePage(db, claim, ports);
  const completed = await settle(true);
  if (!completed) throw new MicrosoftJournalError("settlement_unconfirmed");
  if (
    completed.sourceReceiptId !==
      (page.state === "source_page_stored" ? page.receipt.requestId : null) ||
    completed.observationsStored !==
      (page.state === "source_page_stored" ? page.observationsStored : 0)
  )
    throw new MicrosoftJournalError("settlement_unconfirmed");
  return completed;
}
