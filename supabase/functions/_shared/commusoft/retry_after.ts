/** A provider 429 must extend the shared key gate even if client authority is
 * revoked while the response is in flight. Never trust an unbounded header. */
export class CommusoftThrottle extends Error {
  readonly retryAt: number;
  constructor(header: string | null, now = Date.now()) {
    super("rate_limited");
    this.name = "CommusoftThrottle";
    let requested = NaN;
    if (header && /^\d{1,6}$/.test(header.trim())) requested = now + Number(header.trim()) * 1000;
    else if (header && header.length <= 100 &&
      /^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header))
      requested = Date.parse(header);
    this.retryAt = Math.min(now + 3600000, Math.max(now + 1000,
      Number.isFinite(requested) ? requested : now + 60000));
  }
}
