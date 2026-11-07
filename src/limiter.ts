/**
 * One queue for every Tatum call. The free tier allows about 3 requests per second across all
 * endpoints, so calls are spaced out and retried with backoff when the gateway pushes back.
 */
export type RetryPolicy = { attempts: number; baseDelayMs: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Errors that mean "slow down", from HTTP (429) or gRPC (RESOURCE_EXHAUSTED / UNAVAILABLE). */
export function isRateLimited(error: unknown): boolean {
  const text = String((error as { code?: unknown })?.code ?? '') + ' ' + String(error);
  return /429|RESOURCE_EXHAUSTED|UNAVAILABLE|too many requests/i.test(text);
}

export class RateLimiter {
  private nextSlotMs = 0;
  readonly calls: Record<string, number> = {};
  readonly throttled: Record<string, number> = {};

  constructor(
    private readonly intervalMs: number,
    private readonly retry: RetryPolicy = { attempts: 5, baseDelayMs: 500 },
  ) {}

  /** Wait for the next free slot. Slots are reserved in call order, so the queue is fair. */
  private async slot() {
    const now = Date.now();
    const start = Math.max(now, this.nextSlotMs);
    this.nextSlotMs = start + this.intervalMs;
    if (start > now) await sleep(start - now);
  }

  async run<T>(label: string, action: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.slot();
      this.calls[label] = (this.calls[label] ?? 0) + 1;
      try {
        return await action();
      } catch (error) {
        if (!isRateLimited(error) || attempt >= this.retry.attempts) throw error;
        this.throttled[label] = (this.throttled[label] ?? 0) + 1;
        await sleep(this.retry.baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
}
