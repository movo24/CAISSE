import { formatTicketNumber } from './ticket-number';

describe('POS formatTicketNumber', () => {
  it('zero-pads to 6 digits', () => {
    expect(formatTicketNumber(6)).toBe('T-000006');
    expect(formatTicketNumber(123)).toBe('T-000123');
  });
  it('does not truncate beyond 6 digits', () => {
    expect(formatTicketNumber(1000000)).toBe('T-1000000');
  });
});
