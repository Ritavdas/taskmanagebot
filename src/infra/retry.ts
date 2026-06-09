export interface RetryOptions {
  /** Number of retries after the first attempt. Defaults to 2 (3 attempts total). */
  retries?: number;
  /** Base delay in ms for exponential backoff. Defaults to 500. */
  baseDelayMs?: number;
  /** Called before each retry with the failing error and the upcoming attempt number (1-based). */
  onRetry?: (err: unknown, attempt: number) => void;
}

/** Run an async function, retrying on rejection with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      opts.onRetry?.(err, attempt + 1);
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
