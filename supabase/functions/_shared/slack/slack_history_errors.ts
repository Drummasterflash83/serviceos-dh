/** Deliberately contains no provider response prose, URLs, tokens or messages. */
export class SlackHistoryTransportError extends Error {
  code: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  constructor(code: string, retryable: boolean, retryAfterSeconds?: number) {
    super("Slack history request could not be completed.");
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
