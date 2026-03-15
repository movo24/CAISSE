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
// Redis Implementation (uncomment when ready)
// ─────────────────────────────────────────────────────────────────────────────
//
// import Redis from 'ioredis';
//
// export class RedisCacheStore implements ICacheStore {
//   private redis: Redis;
//
//   constructor(redisUrl?: string) {
//     this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379');
//   }
//
//   async get<T = string>(key: string): Promise<T | null> {
//     const val = await this.redis.get(key);
//     if (val === null) return null;
//     try { return JSON.parse(val) as T; } catch { return val as unknown as T; }
//   }
//
//   async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
//     const serialized = JSON.stringify(value);
//     if (ttlSeconds) {
//       await this.redis.setex(key, ttlSeconds, serialized);
//     } else {
//       await this.redis.set(key, serialized);
//     }
//   }
//
//   async del(key: string): Promise<void> {
//     await this.redis.del(key);
//   }
//
//   async has(key: string): Promise<boolean> {
//     return (await this.redis.exists(key)) === 1;
//   }
//
//   async incr(key: string, ttlSeconds?: number): Promise<number> {
//     const val = await this.redis.incr(key);
//     if (ttlSeconds && val === 1) {
//       await this.redis.expire(key, ttlSeconds);
//     }
//     return val;
//   }
//
//   async sadd(key: string, member: string, ttlSeconds?: number): Promise<void> {
//     await this.redis.sadd(key, member);
//     if (ttlSeconds) await this.redis.expire(key, ttlSeconds);
//   }
//
//   async sismember(key: string, member: string): Promise<boolean> {
//     return (await this.redis.sismember(key, member)) === 1;
//   }
//
//   async srem(key: string, member: string): Promise<void> {
//     await this.redis.srem(key, member);
//   }
// }
