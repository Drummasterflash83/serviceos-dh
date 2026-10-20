/** Bound a browser request even if its auth/session step never reaches fetch. */
export async function settleWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let rejectDeadline: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectDeadline(new Error("Request cancelled"));
  };
  if (externalSignal?.aborted) cancel();
  else externalSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(new Error(timeoutMessage));
  }, timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", cancel);
  }
}
