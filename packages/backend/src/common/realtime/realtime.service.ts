import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface RealtimeEvent {
  storeId: string;
  event: string;
  data: Record<string, unknown>;
}

/**
 * In-process real-time event bus for SSE streaming.
 *
 * NOTE: single-pod only. Events emitted on one instance are not seen by SSE
 * clients connected to another instance. For horizontal scale, back this with
 * Redis pub/sub (see REDIS_URL). Kept dependency-free (RxJS only) for now.
 */
@Injectable()
export class RealtimeService {
  private readonly events$ = new Subject<RealtimeEvent>();

  emit(storeId: string, event: string, data: Record<string, unknown>): void {
    this.events$.next({ storeId, event, data });
  }

  /** SSE stream scoped to one store. */
  streamForStore(storeId: string): Observable<MessageEvent> {
    return this.events$.pipe(
      filter((e) => e.storeId === storeId),
      map((e) => ({ data: { event: e.event, ...e.data } }) as MessageEvent),
    );
  }
}
