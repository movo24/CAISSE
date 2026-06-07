import {
  Injectable,
  Logger,
  MessageEvent,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface RealtimeEvent {
  storeId: string;
  event: string;
  data: Record<string, unknown>;
}

const CHANNEL = 'realtime:events';

/**
 * Real-time event bus for SSE streaming.
 *
 * - Single pod (no REDIS_URL): in-process RxJS Subject.
 * - Multi-pod (REDIS_URL set): events are fanned out via Redis pub/sub so an SSE
 *   client connected to ANY pod receives events emitted on ANY pod. Each pod
 *   publishes to the channel and its own subscriber feeds the local Subject
 *   (no double-delivery — emit() does not also push locally when Redis is active).
 *
 * Fully graceful: a Redis failure falls back to in-process delivery for the local
 * pod, and the app keeps running (same degradation pattern as the cache layer).
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly events$ = new Subject<RealtimeEvent>();
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private redisReady = false;

  constructor(@Optional() @Inject(ConfigService) private readonly config?: ConfigService) {}

  onModuleInit(): void {
    const url = this.config?.get<string>('REDIS_URL');
    if (!url) {
      this.logger.log('Realtime: in-process bus (no REDIS_URL — single-pod fan-out)');
      return;
    }
    try {
      const opts = { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: false, connectTimeout: 1000 } as const;
      this.pub = new Redis(url, opts);
      this.sub = new Redis(url, opts);
      this.pub.on('error', (e) => this.onRedisError(e));
      this.sub.on('error', (e) => this.onRedisError(e));
      this.sub.on('ready', () => { this.redisReady = true; this.logger.log('Realtime: Redis pub/sub fan-out active (multi-pod)'); });
      this.sub.subscribe(CHANNEL).catch((e) => this.onRedisError(e));
      this.sub.on('message', (_channel, payload) => {
        try {
          const evt = JSON.parse(payload) as RealtimeEvent;
          this.events$.next(evt); // feed local SSE subscribers (this pod)
        } catch {
          /* ignore malformed frame */
        }
      });
    } catch (e: any) {
      this.onRedisError(e);
    }
  }

  onModuleDestroy(): void {
    this.pub?.disconnect();
    this.sub?.disconnect();
  }

  private onRedisError(err: any): void {
    if (this.redisReady) this.logger.warn(`Realtime Redis error — falling back to in-process: ${err?.message}`);
    this.redisReady = false;
  }

  emit(storeId: string, event: string, data: Record<string, unknown>): void {
    const evt: RealtimeEvent = { storeId, event, data };
    if (this.redisReady && this.pub) {
      // Publish; our own subscriber will deliver it to local SSE clients.
      this.pub.publish(CHANNEL, JSON.stringify(evt)).catch((e) => {
        this.onRedisError(e);
        this.events$.next(evt); // fallback: still serve local clients
      });
      return;
    }
    this.events$.next(evt); // in-process (single pod, or Redis down)
  }

  /** SSE stream scoped to one store. */
  streamForStore(storeId: string): Observable<MessageEvent> {
    return this.events$.pipe(
      filter((e) => e.storeId === storeId),
      map((e) => ({ data: { event: e.event, ...e.data } }) as MessageEvent),
    );
  }
}
