import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker('TestAPI', {
      failureThreshold: 3,
      cooldownMs: 100,
      timeoutMs: 500,
      retryAttempts: 1,
      retryDelayMs: 10,
    });
  });

  it('should pass through successful calls', async () => {
    const result = await cb.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getState().state).toBe('CLOSED');
  });

  it('should use fallback on failure', async () => {
    const result = await cb.execute(
      async () => { throw new Error('fail'); },
      () => 'fallback-value',
    );
    expect(result).toBe('fallback-value');
  });

  it('should open circuit after threshold failures', async () => {
    const failFn = async () => { throw new Error('fail'); };
    const fallback = () => 'fb';

    // 3 failures to reach threshold
    await cb.execute(failFn, fallback);
    await cb.execute(failFn, fallback);
    await cb.execute(failFn, fallback);

    expect(cb.getState().state).toBe('OPEN');
    expect(cb.getState().failureCount).toBe(3);
  });

  it('should fast-fail when circuit is open', async () => {
    const failFn = async () => { throw new Error('fail'); };
    const fallback = () => 'fb';

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await cb.execute(failFn, fallback);
    }

    // Next call should use fallback immediately (no actual call)
    let callMade = false;
    const result = await cb.execute(
      async () => { callMade = true; return 'should-not-reach'; },
      () => 'fast-fail-fallback',
    );

    expect(result).toBe('fast-fail-fallback');
    expect(callMade).toBe(false);
  });

  it('should transition to half-open after cooldown', async () => {
    const failFn = async () => { throw new Error('fail'); };

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await cb.execute(failFn, () => 'fb');
    }
    expect(cb.getState().state).toBe('OPEN');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 150));

    // Next call should probe (half-open)
    const result = await cb.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState().state).toBe('CLOSED');
  });

  it('should re-open if probe fails in half-open state', async () => {
    const failFn = async () => { throw new Error('fail'); };

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await cb.execute(failFn, () => 'fb');
    }

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 150));

    // Probe fails
    await cb.execute(failFn, () => 'fb-again');
    expect(cb.getState().state).toBe('OPEN');
  });

  it('should timeout slow calls', async () => {
    const slowFn = () => new Promise<string>((resolve) => {
      setTimeout(() => resolve('too-late'), 2000);
    });

    const result = await cb.execute(slowFn, () => 'timeout-fallback');
    expect(result).toBe('timeout-fallback');
  });

  it('should throw when no fallback and circuit is open', async () => {
    const failFn = async () => { throw new Error('fail'); };

    // Open the circuit (use fallback to not throw during setup)
    for (let i = 0; i < 3; i++) {
      await cb.execute(failFn, () => 'fb');
    }

    // Now try without fallback
    await expect(
      cb.execute(async () => 'should-not-reach'),
    ).rejects.toThrow(/circuit is OPEN/);
  });

  it('should reset correctly', async () => {
    const failFn = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await cb.execute(failFn, () => 'fb');
    }
    expect(cb.getState().state).toBe('OPEN');

    cb.reset();
    expect(cb.getState().state).toBe('CLOSED');
    expect(cb.getState().failureCount).toBe(0);
  });
});
