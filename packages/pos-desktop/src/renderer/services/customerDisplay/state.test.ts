import { describe, it, expect } from 'vitest';
import { deriveDisplayState, showsTicket, showsIdleMedia, type DisplayMachineInput } from './state';

const base: DisplayMachineInput = {
  enabled: true,
  blackout: false,
  connectionLost: false,
  itemCount: 0,
  payment: 'none',
};

describe('customerDisplay state machine', () => {
  it('OFF when disabled', () => {
    expect(deriveDisplayState({ ...base, enabled: false })).toBe('off');
  });

  it('OFF when blackout, even with an active cart or payment', () => {
    expect(deriveDisplayState({ ...base, blackout: true, itemCount: 3 })).toBe('off');
    expect(deriveDisplayState({ ...base, blackout: true, payment: 'pending' })).toBe('off');
  });

  it('IDLE when enabled, empty cart, no payment', () => {
    expect(deriveDisplayState(base)).toBe('idle');
  });

  it('CART_ACTIVE when items present', () => {
    expect(deriveDisplayState({ ...base, itemCount: 2 })).toBe('cart_active');
  });

  it('PAYMENT_PENDING overrides cart', () => {
    expect(deriveDisplayState({ ...base, itemCount: 2, payment: 'pending' })).toBe('payment_pending');
  });

  it('PAYMENT_SUCCESS is the highest non-off priority (survives sync blip + empty cart)', () => {
    expect(deriveDisplayState({ ...base, payment: 'success', itemCount: 0, connectionLost: true }))
      .toBe('payment_success');
  });

  it('PAYMENT_FAILED shown when failed and not superseded by success', () => {
    expect(deriveDisplayState({ ...base, payment: 'failed', itemCount: 2 })).toBe('payment_failed');
  });

  it('ERROR_FALLBACK when connection lost and no active payment', () => {
    expect(deriveDisplayState({ ...base, connectionLost: true, itemCount: 5 })).toBe('error_fallback');
    expect(deriveDisplayState({ ...base, connectionLost: true })).toBe('error_fallback');
  });

  it('never returns cart_active while disabled', () => {
    expect(deriveDisplayState({ ...base, enabled: false, itemCount: 9 })).toBe('off');
  });
});

describe('customerDisplay state helpers', () => {
  it('showsTicket in cart + pending', () => {
    expect(showsTicket('cart_active')).toBe(true);
    expect(showsTicket('payment_pending')).toBe(true);
    expect(showsTicket('idle')).toBe(false);
    expect(showsTicket('payment_success')).toBe(false);
  });

  it('showsIdleMedia only in idle', () => {
    expect(showsIdleMedia('idle')).toBe(true);
    expect(showsIdleMedia('cart_active')).toBe(false);
    expect(showsIdleMedia('off')).toBe(false);
  });
});
