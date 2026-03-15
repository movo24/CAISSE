import { Logger } from '@nestjs/common';

/**
 * Circuit Breaker implementation for external API calls.
 *
 * States:
 *   CLOSED   — normal operation, requests pass through
 *   OPEN     — failures exceeded threshold, requests fast-fail with fallback
 *   HALF_OPEN — after cooldown, allow one probe request to test recovery
 *
 * Usage:
 *   const cb = new CircuitBreaker('WeatherAPI', { failureThreshold: 3 });
 *   const result = await cb.execute(() => fetch(url), () => cachedData);
 */

export interface CircuitBreakerOptions {
  /** How many failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** How long to wait before allowing a probe request, in ms (default: 30s) */
  cooldownMs?: number;
  /** Request timeout in ms (default: 8s) */
  timeoutMs?: number;
  /** Number of retry attempts before counting as failure (default: 1) */
  retryAttempts?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelayMs?: number;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private readonly logger: Logger;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.logger = new Logger(`CircuitBreaker:${name}`);
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.retryAttempts = options.retryAttempts ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
  }

  /**
   * Execute a function with circuit breaker protection.
   *
   * @param fn — The async function to execute (e.g. an API call)
   * @param fallback — Optional fallback function when circuit is open or fn fails
   * @returns The result of fn or fallback
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    // --- OPEN state: fast-fail ---
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.logger.warn(`${this.name}: Circuit HALF_OPEN — probing...`);
      } else {
        this.logger.debug(`${this.name}: Circuit OPEN — using fallback`);
        if (fallback) return fallback();
        throw new Error(`${this.name} circuit is OPEN — service unavailable`);
      }
    }

    // --- CLOSED or HALF_OPEN: attempt the call ---
    let lastError: Error | null = null;
    const maxAttempts = this.state === 'HALF_OPEN' ? 1 : this.retryAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.executeWithTimeout(fn);
        this.onSuccess();
        return result;
      } catch (err: any) {
        lastError = err;
        this.logger.warn(
          `${this.name}: Attempt ${attempt}/${maxAttempts} failed: ${err.message}`,
        );
        if (attempt < maxAttempts) {
          await this.delay(this.retryDelayMs);
        }
      }
    }

    // All attempts failed
    this.onFailure(lastError!);

    if (fallback) {
      this.logger.warn(`${this.name}: All attempts failed — using fallback`);
      return fallback();
    }
    throw lastError!;
  }

  /** Get current circuit state for monitoring */
  getState(): { state: CircuitState; failureCount: number; successCount: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }

  /** Reset the circuit breaker (useful for testing) */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  // ─────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.name} request timed out (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.logger.log(`${this.name}: Probe succeeded — Circuit CLOSED`);
    }
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount++;
  }

  private onFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.logger.error(
        `${this.name}: Probe failed — Circuit OPEN again: ${error.message}`,
      );
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.logger.error(
        `${this.name}: ${this.failureCount} failures — Circuit OPEN for ${this.cooldownMs / 1000}s`,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
