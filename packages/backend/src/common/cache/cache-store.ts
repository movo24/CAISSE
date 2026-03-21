/**
 * CacheStore — Unified key-value store with TTL support.
 *
 * Current implementation: In-memory Map (single-instance safe).
 * Production replacement: Redis (drop-in swap via RedisCacheStore).
 *
 * Used by:
 *   - AuthService: lockout tracking, token revocation, token families
 *   - OTP store (customers module)
 *   - Circuit breaker state (optional)
 *
 * Migration to Redis:
 *   1. npm install ioredis @nestjs/cache-manager
 *   2. Replace InMemoryCacheStore with RedisCacheStore in CacheModule
 *   3. No other code changes needed — same interface
 */

export interface ICacheStore {
  /** Get a value. Returns null if expired or missing. */
  get<T = string>(key: string): Promise<T | null>;

  /** Set a value with optional TTL in seconds. */
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;

  /** Delete a key. */
  del(key: string): Promise<void>;

  /** Check if a key exists and is not expired. */
  has(key: string): Promise<boolean>;

  /** Increment a numeric value. Returns new value. Creates with value 1 if missing. */
  incr(key: string, ttlSeconds?: number): Promise<number>;

  /** Add a value to a Set stored at key. */
  sadd(key: string, member: string, ttlSeconds?: number): Promise<void>;

  /** Check if a value is in a Set stored at key. */
  sismember(key: string, member: string): Promise<boolean>;

  /** Remove a value from a Set stored at key. */
  srem(key: string, member: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Implementation (current, single-instance)
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  value: any;
  expiresAt: number | null; // epoch ms, null = no expiry
}

export class InMemoryCacheStore implements ICacheStore {
  private store = new Map<string, CacheEntry>();
  private sets = new Map<string, { members: Set<string>; expiresAt: number | null }>();

  async get<T = string>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    this.sets.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const current = await this.get<number>(key);
    const newVal = (current ?? 0) + 1;
    await this.set(key, newVal, ttlSeconds);
    return newVal;
  }

  async sadd(key: string, member: string, ttlSeconds?: number): Promise<void> {
    let entry = this.sets.get(key);
    if (!entry || (entry.expiresAt && Date.now() > entry.expiresAt)) {
      entry = {
        members: new Set(),
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      };
      this.sets.set(key, entry);
    }
    entry.members.add(member);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const entry = this.sets.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.sets.delete(key);
      return false;
    }
    return entry.members.has(member);
  }

  async srem(key: string, member: string): Promise<void> {
    const entry = this.sets.get(key);
    if (entry) {
      entry.members.delete(member);
      if (entry.members.size === 0) this.sets.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis Implementation — production-grade, multi-instance safe
// ─────────────────────────────────────────────────────────────────────────────

import Redis from 'ioredis';
import { Logger } from '@nestjs/common';

export class RedisCacheStore implements ICacheStore {
  readonly redis: Redis;
  private readonly prefix = 'pos:';

  constructor(redisUrl?: string) {
    this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 10) return null; // stop retrying after 10 attempts
        return Math.min(times * 200, 3000);
      },
      lazyConnect: false,
      enableReadyCheck: true,
      enableOfflineQueue: false, // Fail immediately when disconnected — no buffering
      connectTimeout: 1000,
      commandTimeout: 1000,
    });
    this.redis.on('error', (err) => {
      console.error(`[Redis] Connection error: ${err.message}`);
    });
    this.redis.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }

  private k(key: string): string { return this.prefix + key; }

  async get<T = string>(key: string): Promise<T | null> {
    const val = await this.redis.get(this.k(key));
    if (val === null) return null;
    try { return JSON.parse(val) as T; } catch { return val as unknown as T; }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.setex(this.k(key), ttlSeconds, serialized);
    } else {
      await this.redis.set(this.k(key), serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(this.k(key))) === 1;
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const val = await this.redis.incr(this.k(key));
    if (ttlSeconds && val === 1) {
      await this.redis.expire(this.k(key), ttlSeconds);
    }
    return val;
  }

  async sadd(key: string, member: string, ttlSeconds?: number): Promise<void> {
    await this.redis.sadd(this.k(key), member);
    if (ttlSeconds) await this.redis.expire(this.k(key), ttlSeconds);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return (await this.redis.sismember(this.k(key), member)) === 1;
  }

  async srem(key: string, member: string): Promise<void> {
    await this.redis.srem(this.k(key), member);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resilient Implementation — Redis primary with automatic in-memory fallback
// ─────────────────────────────────────────────────────────────────────────────

export type CacheStoreState = 'REDIS' | 'FALLBACK';

export interface CacheStoreStatus {
  state: CacheStoreState;
  lastError: string | null;
  downSince: string | null;
  failCount: number;
}

export class ResilientCacheStore implements ICacheStore {
  private readonly logger = new Logger('ResilientCacheStore');
  private readonly redis: RedisCacheStore;
  private readonly fallback: InMemoryCacheStore;
  private state: CacheStoreState = 'REDIS';
  private failCount = 0;
  private readonly failThreshold: number;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly healthCheckIntervalMs: number;
  private lastStateChange = Date.now();
  private lastError: string | null = null;
  private onStateChange?: (state: CacheStoreState, error?: string) => void;

  constructor(
    redisUrl?: string,
    options?: {
      failThreshold?: number;
      healthCheckIntervalMs?: number;
      onStateChange?: (state: CacheStoreState, error?: string) => void;
    },
  ) {
    this.redis = new RedisCacheStore(redisUrl);
    this.fallback = new InMemoryCacheStore();
    this.failThreshold = options?.failThreshold ?? 2;
    this.healthCheckIntervalMs = options?.healthCheckIntervalMs ?? 5_000;
    this.onStateChange = options?.onStateChange;

    // React to ioredis connection events for instant detection
    this.redis.redis.on('close', () => {
      if (this.state === 'REDIS') {
        this.switchToFallback(new Error('Connection closed'));
      }
    });
    this.redis.redis.on('end', () => {
      if (this.state === 'REDIS') {
        this.switchToFallback(new Error('Connection ended'));
      }
    });
    this.redis.redis.on('ready', () => {
      if (this.state === 'FALLBACK') {
        this.switchToRedis();
      }
    });
  }

  getState(): CacheStoreState {
    return this.state;
  }

  getStatus(): CacheStoreStatus {
    return {
      state: this.state,
      lastError: this.lastError,
      downSince: this.state === 'FALLBACK'
        ? new Date(this.lastStateChange).toISOString()
        : null,
      failCount: this.failCount,
    };
  }

  /**
   * Active probe — checks ioredis connection status AND pings Redis.
   * Returns true only if Redis is actually reachable right now.
   */
  async probe(): Promise<boolean> {
    // Step 1: Check ioredis internal status — instant, no I/O
    const ioStatus = this.redis.redis.status;
    if (ioStatus !== 'ready') {
      if (this.state === 'REDIS') {
        this.switchToFallback(new Error(`ioredis status: ${ioStatus}`));
      }
      // If in fallback, try reconnect so the probe can trigger recovery
      if (this.state === 'FALLBACK' && (ioStatus === 'end' || ioStatus === 'close' || ioStatus === 'wait')) {
        try { await this.redis.redis.connect(); } catch { return false; }
        // If connect succeeded, fall through to PING check
        if (this.redis.redis.status !== 'ready') return false;
      } else {
        return false;
      }
    }

    // Step 2: Actual PING with hard 800ms timeout
    try {
      const pong = await Promise.race([
        this.redis.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Probe timeout')), 800),
        ),
      ]);
      if (pong === 'PONG') {
        if (this.state === 'FALLBACK') this.switchToRedis();
        return true;
      }
      return false;
    } catch (err) {
      if (this.state === 'REDIS') {
        this.switchToFallback(err as Error);
      }
      return false;
    }
  }

  private switchToFallback(err: Error): void {
    if (this.state === 'FALLBACK') return;
    this.state = 'FALLBACK';
    this.lastStateChange = Date.now();
    this.lastError = err.message;
    this.logger.error(
      `Redis DOWN — switching to in-memory fallback. Error: ${err.message}`,
    );
    this.onStateChange?.('FALLBACK', err.message);
    this.startHealthCheck();
  }

  private switchToRedis(): void {
    if (this.state === 'REDIS') return;
    const downDurationMs = Date.now() - this.lastStateChange;
    this.state = 'REDIS';
    this.failCount = 0;
    this.lastError = null;
    this.lastStateChange = Date.now();
    this.logger.log(
      `Redis RECOVERED — switching back (was down ${Math.round(downDurationMs / 1000)}s)`,
    );
    this.onStateChange?.('REDIS');
    this.stopHealthCheck();
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(async () => {
      try {
        // If ioredis gave up (status = 'end'), force a reconnect attempt
        const status = this.redis.redis.status;
        if (status === 'end' || status === 'close') {
          this.logger.log('Health check: ioredis is dead, attempting reconnect...');
          try { await this.redis.redis.connect(); } catch { /* will retry next interval */ return; }
        }

        const pong = await Promise.race([
          this.redis.redis.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 800),
          ),
        ]);
        if (pong === 'PONG') {
          this.switchToRedis();
        }
      } catch {
        this.logger.warn('Redis health check failed — still in fallback mode');
      }
    }, this.healthCheckIntervalMs);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async run<T>(
    redisFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
  ): Promise<T> {
    if (this.state === 'FALLBACK') {
      return fallbackFn();
    }
    try {
      const result = await redisFn();
      if (this.failCount > 0) this.failCount = 0;
      return result;
    } catch (err) {
      this.failCount++;
      this.lastError = (err as Error).message;
      if (this.failCount >= this.failThreshold) {
        this.switchToFallback(err as Error);
      } else {
        this.logger.warn(
          `Redis error (${this.failCount}/${this.failThreshold}): ${(err as Error).message}`,
        );
      }
      return fallbackFn();
    }
  }

  async get<T = string>(key: string): Promise<T | null> {
    return this.run(() => this.redis.get<T>(key), () => this.fallback.get<T>(key));
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    return this.run(
      () => this.redis.set(key, value, ttlSeconds),
      () => this.fallback.set(key, value, ttlSeconds),
    );
  }

  async del(key: string): Promise<void> {
    return this.run(() => this.redis.del(key), () => this.fallback.del(key));
  }

  async has(key: string): Promise<boolean> {
    return this.run(() => this.redis.has(key), () => this.fallback.has(key));
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    return this.run(
      () => this.redis.incr(key, ttlSeconds),
      () => this.fallback.incr(key, ttlSeconds),
    );
  }

  async sadd(key: string, member: string, ttlSeconds?: number): Promise<void> {
    return this.run(
      () => this.redis.sadd(key, member, ttlSeconds),
      () => this.fallback.sadd(key, member, ttlSeconds),
    );
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return this.run(
      () => this.redis.sismember(key, member),
      () => this.fallback.sismember(key, member),
    );
  }

  async srem(key: string, member: string): Promise<void> {
    return this.run(
      () => this.redis.srem(key, member),
      () => this.fallback.srem(key, member),
    );
  }
}
