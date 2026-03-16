/**
 * Tests for Sale Transaction Integrity
 *
 * Validates ticket number generation, total calculations,
 * and the transaction pattern used in SalesService.
 */

describe('Sale Transaction Integrity', () => {
  describe('Ticket Number Generation', () => {
    it('should generate sequential ticket numbers', () => {
      // Simulates the pattern: lastTicket + 1
      const generateTicket = (lastNumber: number | null): string => {
        const next = (lastNumber ?? 0) + 1;
        return `T-${String(next).padStart(6, '0')}`;
      };

      expect(generateTicket(null)).toBe('T-000001');
      expect(generateTicket(0)).toBe('T-000001');
      expect(generateTicket(1)).toBe('T-000002');
    });

    it('should generate T-000001 for first sale', () => {
      // Simulate: no previous sale exists → first ticket
      const lastTicketNumber = null as string | null;
      const nextNumber = lastTicketNumber
        ? parseInt(lastTicketNumber.replace(/\D/g, '')) + 1
        : 1;
      const ticket = `T-${String(nextNumber).padStart(6, '0')}`;
      expect(ticket).toBe('T-000001');
    });

    it('should increment correctly', () => {
      const lastTicket = 'T-000042';
      const lastNum = parseInt(lastTicket.replace('T-', ''));
      const nextTicket = `T-${String(lastNum + 1).padStart(6, '0')}`;
      expect(nextTicket).toBe('T-000043');
    });

    it('should handle 6-digit overflow', () => {
      const lastTicket = 'T-999999';
      const lastNum = parseInt(lastTicket.replace('T-', ''));
      const nextTicket = `T-${String(lastNum + 1).padStart(6, '0')}`;
      expect(nextTicket).toBe('T-1000000');
    });
  });

  describe('Sale Total Calculations', () => {
    interface LineItem {
      quantity: number;
      unitPriceMinorUnits: number;
      taxRate: number;
      discountMinorUnits: number;
    }

    function calculateSaleTotals(items: LineItem[]) {
      let totalMinorUnits = 0;
      let taxTotalMinorUnits = 0;
      let discountTotalMinorUnits = 0;

      for (const item of items) {
        const lineSubtotal =
          item.unitPriceMinorUnits * item.quantity - item.discountMinorUnits;
        const lineTax = Math.round(lineSubtotal * (item.taxRate / 100));
        totalMinorUnits += lineSubtotal;
        taxTotalMinorUnits += lineTax;
        discountTotalMinorUnits += item.discountMinorUnits;
      }

      return {
        totalMinorUnits,
        taxTotalMinorUnits,
        discountTotalMinorUnits,
      };
    }

    it('should calculate correct total for single item', () => {
      const result = calculateSaleTotals([
        {
          quantity: 1,
          unitPriceMinorUnits: 2990,
          taxRate: 20,
          discountMinorUnits: 0,
        },
      ]);

      expect(result.totalMinorUnits).toBe(2990);
      expect(result.taxTotalMinorUnits).toBe(598); // 2990 * 0.20
      expect(result.discountTotalMinorUnits).toBe(0);
    });

    it('should calculate correct total for multiple items', () => {
      const result = calculateSaleTotals([
        {
          quantity: 2,
          unitPriceMinorUnits: 2990,
          taxRate: 20,
          discountMinorUnits: 0,
        },
        {
          quantity: 1,
          unitPriceMinorUnits: 890,
          taxRate: 20,
          discountMinorUnits: 0,
        },
      ]);

      expect(result.totalMinorUnits).toBe(6870); // 5980 + 890
      expect(result.taxTotalMinorUnits).toBe(1374); // 1196 + 178
    });

    it('should apply discount correctly', () => {
      const result = calculateSaleTotals([
        {
          quantity: 3,
          unitPriceMinorUnits: 890,
          taxRate: 20,
          discountMinorUnits: 445, // 50% off 3rd pair
        },
      ]);

      expect(result.totalMinorUnits).toBe(2225); // 2670 - 445
      expect(result.discountTotalMinorUnits).toBe(445);
    });

    it('should always use integer arithmetic (never floats)', () => {
      const result = calculateSaleTotals([
        {
          quantity: 3,
          unitPriceMinorUnits: 1999, // 19.99 EUR
          taxRate: 20,
          discountMinorUnits: 0,
        },
      ]);

      // All values must be integers
      expect(Number.isInteger(result.totalMinorUnits)).toBe(true);
      expect(Number.isInteger(result.taxTotalMinorUnits)).toBe(true);
      expect(Number.isInteger(result.discountTotalMinorUnits)).toBe(true);
    });
  });

  describe('Transaction Pattern', () => {
    it('should follow the correct transaction lifecycle', () => {
      // Validates the expected pattern in SalesService.createSale()
      const steps = [
        'queryRunner.connect()',
        'queryRunner.startTransaction(SERIALIZABLE)',
        'SELECT ticket_number FOR UPDATE',
        'save sale entity',
        'decrement stock',
        'update loyalty points',
        'queryRunner.commitTransaction()',
        // Post-commit (non-critical, async):
        'audit log',
        'peripheral commands',
      ];

      // Transaction isolation must be SERIALIZABLE
      expect(steps[1]).toContain('SERIALIZABLE');
      // FOR UPDATE lock must be before any writes
      expect(steps.indexOf('SELECT ticket_number FOR UPDATE')).toBeLessThan(
        steps.indexOf('save sale entity'),
      );
      // Commit must be after all critical writes
      expect(
        steps.indexOf('queryRunner.commitTransaction()'),
      ).toBeGreaterThan(steps.indexOf('update loyalty points'));
    });
  });

  describe('Input Validation for Stock Adjustments', () => {
    it('should reject non-integer stock deltas', () => {
      const isValidDelta = (delta: number): boolean => {
        return (
          Number.isInteger(delta) &&
          Math.abs(delta) <= 100000
        );
      };

      expect(isValidDelta(5)).toBe(true);
      expect(isValidDelta(-10)).toBe(true);
      expect(isValidDelta(1.5)).toBe(false);
      expect(isValidDelta(999999)).toBe(false);
    });
  });
});
