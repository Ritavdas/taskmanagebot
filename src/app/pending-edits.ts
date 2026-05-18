import type { IssueUpdateFields } from '../infra/linear.ts';

interface PendingEdit {
  issueId: string;
  identifier: string;
  updates: IssueUpdateFields;
}

/** Single-owner bot, so a single pending edit slot is enough. */
export class PendingEditsStore {
  #current: PendingEdit | null = null;

  set(edit: PendingEdit): void { this.#current = edit; }
  take(): PendingEdit | null {
    const v = this.#current;
    this.#current = null;
    return v;
  }
  clear(): boolean {
    const had = this.#current !== null;
    this.#current = null;
    return had;
  }
  has(): boolean { return this.#current !== null; }
}
