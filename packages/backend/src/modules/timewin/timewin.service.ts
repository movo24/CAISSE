import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';
import { AlertService } from '../../common/alert/alert.service';

/* ── Types ── */

export interface TimewinEmployee {
  employee_id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  role: string;
  timewin_role: string;
  permissions: TimewinPermissions;
  max_discount: number;
  active: boolean;
  allowed_stores: string[];
  session_token: string;
  store_id: string;
  device_id: string | null;
  snapshot: {
    employee_id: string;
    employee_name: string;
    employee_role: string;
    max_discount: number;
    captured_at: string;
  };
}

export interface TimewinPermissions {
  open_register: boolean;
  close_register: boolean;
  void_sale: boolean;
  refund: boolean;
  discount_max: number;
  access_backoffice: boolean;
  manage_stock: boolean;
  view_reports: boolean;
  manage_employees: boolean;
}

export interface TimewinEmployeeContext {
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  active: boolean;
  user_active: boolean;
  pos_role: string;
  timewin_role: string;
  max_discount: number;
  skills: string[];
  allowed_stores: { store_id: string; name: string; city: string; status: string }[];
  qr_code: string | null;
}

export interface TimewinClockResult {
  clock_in_id: string;
  employee_id: string;
  store_id: string;
  clock_in_at?: string;
  clock_out_at?: string;
  worked_hours?: number;
  status: string;
  late_minutes: number;
  source: string;
}

export interface CachedEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  /** bcrypt hash of the PIN — NEVER stored in plaintext */
  posPinHash: string;
  posRole: string;
  maxDiscountPct: number;
  skills: string[];
  cachedAt: number;
}

/* ── Service ── */

@Injectable()
export class TimewinService implements OnModuleInit {
  private readonly logger = new Logger(TimewinService.name);
  private baseUrl: string;
  private apiKey: string;
  private posSecret: string;
  private posKeyId: string;

  /** Offline cache: storeId -> employees */
  private employeeCache = new Map<string, CachedEmployee[]>();
  private cacheTTL = 30 * 60 * 1000; // 30 minutes

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.baseUrl = this.config.get('TIMEWIN24_URL', 'http://localhost:3000');
    this.apiKey = this.config.get('TIMEWIN24_API_KEY', '');
    this.posSecret = this.config.get('TIMEWIN24_POS_SECRET', '');
    this.posKeyId = this.config.get('TIMEWIN24_POS_KEY_ID', '');

    // Configurable timeouts and retry from env
    const envTimeout = this.config.get('TIMEWIN24_TIMEOUT_MS');
    if (envTimeout) this.fetchTimeout = parseInt(envTimeout, 10);
    const envRetry = this.config.get('TIMEWIN24_RETRY_COUNT');
    if (envRetry) this.cbThreshold = parseInt(envRetry, 10);
    const envResetMs = this.config.get('TIMEWIN24_RETRY_DELAY_MS');
    if (envResetMs) this.cbResetMs = parseInt(envResetMs, 10);

    if (!this.apiKey && !this.posSecret) {
      this.logger.warn('No TIMEWIN24_API_KEY or TIMEWIN24_POS_SECRET configured — TimeWin24 integration disabled');
    } else {
      this.logger.log(`TimeWin24 integration configured: ${this.baseUrl} (timeout=${this.fetchTimeout}ms, circuit=${this.cbThreshold} failures/${this.cbResetMs}ms)`);
    }
  }

  /* ── Health check ── */

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.fetch('/api/health');
      return res.status === 'ok' || res.status === 'degraded';
    } catch {
      return false;
    }
  }

  /* ── Employee login (POS calls this instead of local auth) ── */

  async loginEmployee(opts: {
    pin?: string;
    qrCode?: string;
    employeeCode?: string;
    storeId: string;
    deviceId?: string;
  }): Promise<TimewinEmployee> {
    return this.fetch('/api/auth/employee-login', {
      method: 'POST',
      body: {
        pin: opts.pin,
        qrCode: opts.qrCode,
        employeeCode: opts.employeeCode,
        storeId: opts.storeId,
        deviceId: opts.deviceId,
      },
    });
  }

  /* ── Employee context ── */

  async getEmployeeContext(employeeId: string): Promise<TimewinEmployeeContext> {
    return this.fetch(`/api/employees/${employeeId}/context`);
  }

  /* ── Bulk employees for offline cache ── */

  async syncEmployees(storeId: string): Promise<CachedEmployee[]> {
    const data = await this.fetchWithPosSecret(`/api/pos-feed/employees?storeId=${storeId}`);
    const employees: CachedEmployee[] = (data.employees || []).map((e: any) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      active: e.active,
      posPinHash: '', // will be set below — posPin no longer returned by TimeWin24
      posRole: e.posRole,
      maxDiscountPct: e.maxDiscountPct,
      skills: e.skills || [],
      cachedAt: Date.now(),
    }));
    this.employeeCache.set(storeId, employees);
    return employees;
  }

  /** Get cached employees for offline mode */
  getCachedEmployees(storeId: string): CachedEmployee[] | null {
    const cached = this.employeeCache.get(storeId);
    if (!cached || !cached.length) return null;
    const age = Date.now() - cached[0].cachedAt;
    if (age > this.cacheTTL) return null;
    return cached;
  }

  /* ── Today's shifts ── */

  async getTodayShifts(storeId: string): Promise<any> {
    return this.fetchWithPosSecret(`/api/pos-feed/today-shifts?storeId=${storeId}`);
  }

  /* ── Store schedule (operating hours) ── */

  async getStoreSchedule(storeId: string): Promise<any> {
    return this.fetchWithPosSecret(`/api/pos-feed/store-schedules?storeId=${storeId}`);
  }

  async updateStoreSchedule(storeId: string, schedules: any[]): Promise<any> {
    return this.fetchWithPosSecret(`/api/pos-feed/store-schedules?storeId=${storeId}`, {
      method: 'PUT',
      body: { schedules },
    });
  }

  /* ── Store config ── */

  async getStoreConfig(storeId: string): Promise<any> {
    return this.fetchWithPosSecret(`/api/pos-feed/store-config?storeId=${storeId}`);
  }

  /* ── Attendance ── */

  async clockIn(employeeId: string, storeId: string, source = 'pos'): Promise<TimewinClockResult> {
    return this.fetch('/api/attendance/clock-in', {
      method: 'POST',
      body: { employeeId, storeId, source },
    });
  }

  async clockOut(employeeId: string, storeId: string, source = 'pos'): Promise<TimewinClockResult> {
    return this.fetch('/api/attendance/clock-out', {
      method: 'POST',
      body: { employeeId, storeId, source },
    });
  }

  /* ── POS events → TimeWin24 ── */

  async pushEvent(
    storeId: string,
    eventType: 'sale.completed' | 'session.opened' | 'session.closed' | 'stock.alert' | 'store.created' | 'store.updated' | 'pointage' | 'cashier_metrics' | 'staffing_snapshot',
    employeeId?: string,
    data?: Record<string, unknown>,
  ): Promise<{ received: boolean; eventId: string }> {
    return this.fetchWithPosSecret('/api/pos-events/webhook', {
      method: 'POST',
      headers: { 'X-POS-Store-Id': storeId },
      body: { eventType, employeeId, data },
    });
  }

  /* ── HTTP helpers ── */

  /** Timeout for TimeWin24 calls (ms) — overridable via TIMEWIN24_TIMEOUT_MS */
  private fetchTimeout = 10_000;

  /* ── Circuit breaker: CLOSED → OPEN → HALF-OPEN → CLOSED/OPEN ── */
  private cbState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private cbFailures = 0;
  private cbLastFailure = 0;
  private cbThreshold = 3;       // failures before OPEN
  private cbResetMs = 30_000;    // time in OPEN before trying HALF_OPEN
  private cbHalfOpenMax = 1;     // max concurrent probes in HALF_OPEN

  getCircuitState(): string { return this.cbState; }

  private cbRecordSuccess(): void {
    if (this.cbState === 'HALF_OPEN') {
      this.logger.log('Circuit breaker: HALF_OPEN → CLOSED (probe succeeded)');
      AlertService.instance.fire('CIRCUIT_BREAKER_CLOSED', 'TimeWin24 circuit breaker recovered');
    }
    this.cbState = 'CLOSED';
    this.cbFailures = 0;
  }

  private cbRecordFailure(): void {
    this.cbFailures++;
    this.cbLastFailure = Date.now();
    if (this.cbState === 'HALF_OPEN') {
      this.cbState = 'OPEN';
      this.logger.error(`Circuit breaker: HALF_OPEN → OPEN (probe failed, ${this.cbFailures} total failures)`);
      AlertService.instance.fire('CIRCUIT_BREAKER_OPEN', `TimeWin24 circuit breaker re-opened (${this.cbFailures} failures)`);
    } else if (this.cbFailures >= this.cbThreshold) {
      this.cbState = 'OPEN';
      this.logger.error(`Circuit breaker: CLOSED → OPEN (${this.cbFailures} consecutive failures)`);
      AlertService.instance.fire('CIRCUIT_BREAKER_OPEN', `TimeWin24 circuit breaker opened (${this.cbFailures} failures)`);
      AlertService.instance.fire('TIMEWIN_DOWN', `TimeWin24 unreachable after ${this.cbFailures} failures`);
    }
  }

  private cbCanAttempt(): boolean {
    if (this.cbState === 'CLOSED') return true;
    if (this.cbState === 'OPEN') {
      if (Date.now() - this.cbLastFailure >= this.cbResetMs) {
        this.cbState = 'HALF_OPEN';
        this.logger.log(`Circuit breaker: OPEN → HALF_OPEN (${this.cbResetMs}ms elapsed, allowing probe)`);
        return true;
      }
      return false;
    }
    // HALF_OPEN — allow one probe
    return true;
  }

  private async fetch(path: string, opts?: { method?: string; body?: any; headers?: Record<string, string> }): Promise<any> {
    // Circuit breaker gate
    if (!this.cbCanAttempt()) {
      const err = new Error(`TimeWin24 circuit breaker OPEN — ${path} blocked (${this.cbFailures} failures, retry in ${Math.round((this.cbResetMs - (Date.now() - this.cbLastFailure)) / 1000)}s)`);
      (err as any).status = 503;
      throw err;
    }

    const url = `${this.baseUrl}${path}`;
    const method = opts?.method || 'GET';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...opts?.headers,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeout);

    try {
      const res = await globalThis.fetch(url, {
        method,
        headers,
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
        const err = new Error(parsed.error || `TimeWin24 ${method} ${path} failed: ${res.status}`);
        (err as any).status = res.status;
        (err as any).response = parsed;
        if (res.status >= 500) {
          this.cbRecordFailure();
        }
        throw err;
      }

      // Success — circuit breaker recovery
      this.cbRecordSuccess();
      return res.json();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this.cbRecordFailure();
        const timeoutErr = new Error(`TimeWin24 ${method} ${path} timed out after ${this.fetchTimeout}ms`);
        (timeoutErr as any).status = 504;
        throw timeoutErr;
      }
      if (!err.status) {
        this.cbRecordFailure();
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchWithPosSecret(path: string, opts?: { method?: string; body?: any; headers?: Record<string, string> }): Promise<any> {
    const headers: Record<string, string> = { ...opts?.headers };

    if (this.posSecret && this.posKeyId) {
      // HMAC SHA-256 authentication
      const timestamp = String(Date.now());
      const nonce = randomUUID();
      const bodyStr = opts?.body ? JSON.stringify(opts.body) : '';
      const payload = `${timestamp}.${nonce}.${bodyStr}`;
      const signature = createHmac('sha256', this.posSecret).update(payload).digest('hex');

      headers['X-POS-Timestamp'] = timestamp;
      headers['X-POS-Nonce'] = nonce;
      headers['X-POS-Signature'] = signature;
      headers['X-POS-Key-Id'] = this.posKeyId;
    } else if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return this.fetch(path, { ...opts, headers });
  }

  /** Fetch all active stores from TimeWin24 (source of truth) */
  async fetchStores(): Promise<any[]> {
    const data = await this.fetchWithPosSecret('/api/pos-feed/stores');
    return data.stores || [];
  }
}
