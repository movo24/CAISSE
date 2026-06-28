import { mapTimewinEmployee } from './employee-map';

describe('TimeWin24 mapTimewinEmployee', () => {
  const raw = {
    id: 'e1',
    employeeCode: 'EMP001',
    firstName: 'Alice',
    lastName: 'Martin',
    email: 'a@wesley.fr',
    active: true,
    posRole: 'cashier',
    maxDiscountPct: 5,
    skills: ['caisse'],
  };

  it('maps all fields and stamps cachedAt', () => {
    const m = mapTimewinEmployee(raw, 1700);
    expect(m).toMatchObject({
      id: 'e1',
      employeeCode: 'EMP001',
      firstName: 'Alice',
      posRole: 'cashier',
      maxDiscountPct: 5,
      skills: ['caisse'],
      cachedAt: 1700,
    });
  });

  it('posPinHash is empty (PIN not returned by TimeWin24)', () => {
    expect(mapTimewinEmployee(raw, 1).posPinHash).toBe('');
  });

  it('defaults skills to [] when absent', () => {
    expect(mapTimewinEmployee({ ...raw, skills: undefined }, 1).skills).toEqual([]);
  });
});
