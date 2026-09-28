export type PracticeDraft = { id: string; body: string; version: number };
export type PracticeDraftTransport = {
  save: (draft: PracticeDraft) => Promise<PracticeDraft>;
  complete: (draft: PracticeDraft) => Promise<string | null>;
};

/** Serialises autosave and submission so a navigation flush cannot overtake typing. */
export class PracticeFeedbackDraft {
  private draft: PracticeDraft;
  private savedBody: string;
  private queue: Promise<unknown> = Promise.resolve();
  private submitted: string | null | undefined;
  private transport: PracticeDraftTransport;

  constructor(initial: PracticeDraft, transport: PracticeDraftTransport) {
    this.draft = { ...initial };
    this.transport = transport;
    this.savedBody = initial.version ? initial.body : "";
  }

  edit(body: string) {
    if (this.submitted !== undefined) throw Error("This report has already been sent.");
    this.draft.body = body;
  }

  get dirty() {
    return this.draft.body !== this.savedBody;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(work);
    this.queue = next;
    return next;
  }

  private async saveLatest() {
    if (!this.dirty) return;
    const snapshot = { ...this.draft };
    const result = await this.transport.save(snapshot);
    this.draft.version = result.version;
    this.savedBody = snapshot.body;
  }

  persist() {
    return this.serial(async () => {
      if (this.submitted === undefined) await this.saveLatest();
    });
  }

  complete() {
    return this.serial(async () => {
      if (this.submitted !== undefined) return this.submitted;
      while (this.dirty) await this.saveLatest();
      if (!this.draft.version) return null;
      const result = await this.transport.complete({ ...this.draft });
      if (result) this.submitted = result;
      else {
        this.draft.version = 0;
        this.savedBody = "";
      }
      return result;
    });
  }
}
