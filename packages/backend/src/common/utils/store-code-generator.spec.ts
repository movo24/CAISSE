import { generateStoreCode, generateUniqueStoreCode } from './store-code-generator';

describe('Store Code Generator', () => {
  describe('generateStoreCode', () => {
    it('should generate code from name and city', () => {
      const code = generateStoreCode('Boutique Opera', 'Paris');
      expect(code).toBe('BTQ-PARIS-001');
    });

    it('should generate code without city', () => {
      const code = generateStoreCode('Magasin Principal');
      expect(code).toBe('MGS-001');
    });

    it('should handle accented characters', () => {
      const code = generateStoreCode('Boutique Elysee', 'Cergy-Pontoise');
      expect(code).toMatch(/^[A-Z]{3}-[A-Z]+-\d{3}$/);
    });

    it('should handle short names', () => {
      const code = generateStoreCode('AB', 'Lyon');
      expect(code).toMatch(/^[A-Z]{3}-LYON-001$/);
    });

    it('should increment sequence', () => {
      const code1 = generateStoreCode('Test', 'Paris', 1);
      const code2 = generateStoreCode('Test', 'Paris', 42);
      expect(code1).toContain('-001');
      expect(code2).toContain('-042');
    });

    it('should truncate long city names', () => {
      const code = generateStoreCode('Shop', 'Saint-Germain-en-Laye');
      // City should be max 5 chars
      expect(code.split('-')[1].length).toBeLessThanOrEqual(5);
    });
  });

  describe('generateUniqueStoreCode', () => {
    it('should return first candidate when no collision', async () => {
      const checker = jest.fn().mockResolvedValue(false);
      const code = await generateUniqueStoreCode('Boutique', 'Paris', checker);
      expect(code).toContain('-001');
      expect(checker).toHaveBeenCalledTimes(1);
    });

    it('should increment on collision', async () => {
      const checker = jest.fn()
        .mockResolvedValueOnce(true)  // 001 exists
        .mockResolvedValueOnce(true)  // 002 exists
        .mockResolvedValueOnce(false); // 003 is free
      const code = await generateUniqueStoreCode('Boutique', 'Paris', checker);
      expect(code).toContain('-003');
      expect(checker).toHaveBeenCalledTimes(3);
    });
  });
});
