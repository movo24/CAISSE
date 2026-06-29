import {
  daysSince,
  isInactiveCustomer,
  baseReactivationPriority,
  priorityRank,
  stockNotificationLevel,
} from './reminder-policy';

describe('POS notifications reminder-policy', () => {
  const now = new Date('2026-06-28T00:00:00Z').getTime();

  describe('daysSince', () => {
    it('null when never visited', () => {
      expect(daysSince(null, now)).toBeNull();
    });
    it('floors whole days', () => {
      const d = new Date(now - 5.9 * 86400000);
      expect(daysSince(d, now)).toBe(5);
    });
  });

  describe('isInactiveCustomer', () => {
    it('never visited → inactive', () => {
      expect(isInactiveCustomer(null, true, 30)).toBe(true);
    });
    it('threshold inclusive', () => {
      expect(isInactiveCustomer(30, false, 30)).toBe(true);
      expect(isInactiveCustomer(29, false, 30)).toBe(false);
    });
  });

  describe('baseReactivationPriority', () => {
    it('never visited → medium', () => {
      expect(baseReactivationPriority(null, true)).toBe('medium');
    });
    it('>=90 → high, >=60 → medium, else low', () => {
      expect(baseReactivationPriority(120, false)).toBe('high');
      expect(baseReactivationPriority(90, false)).toBe('high');
      expect(baseReactivationPriority(75, false)).toBe('medium');
      expect(baseReactivationPriority(60, false)).toBe('medium');
      expect(baseReactivationPriority(40, false)).toBe('low');
    });
  });

  describe('priorityRank', () => {
    it('orders high<medium<low', () => {
      expect(priorityRank('high')).toBeLessThan(priorityRank('medium'));
      expect(priorityRank('medium')).toBeLessThan(priorityRank('low'));
    });
  });

  describe('stockNotificationLevel', () => {
    it('out of stock at <=0', () => {
      expect(stockNotificationLevel(0, 3, 10)).toBe('out_of_stock');
      expect(stockNotificationLevel(-2, 3, 10)).toBe('out_of_stock');
    });
    it('critical before alert (order matters)', () => {
      expect(stockNotificationLevel(3, 3, 10)).toBe('critical');
      expect(stockNotificationLevel(8, 3, 10)).toBe('alert');
    });
    it('healthy → null', () => {
      expect(stockNotificationLevel(50, 3, 10)).toBeNull();
    });
  });
});
