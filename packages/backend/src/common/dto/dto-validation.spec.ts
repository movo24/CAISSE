import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateStoreDto } from './stores.dto';
import { CreateOrganizationDto } from './organizations.dto';
import { CreateUnitDto } from './units.dto';
import { CreateConnectedAppDto } from './connected-apps.dto';

describe('DTO Validation', () => {
  // ── CreateStoreDto ──────────────────────────────────────────────

  describe('CreateStoreDto', () => {
    it('should pass with valid name', async () => {
      const dto = plainToInstance(CreateStoreDto, { name: 'Boutique Test' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when name is empty', async () => {
      const dto = plainToInstance(CreateStoreDto, { name: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('name');
    });

    it('should fail when name exceeds 200 chars', async () => {
      const dto = plainToInstance(CreateStoreDto, { name: 'A'.repeat(201) });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail when storeCode exceeds 20 chars', async () => {
      const dto = plainToInstance(CreateStoreDto, {
        name: 'Valid',
        storeCode: 'X'.repeat(21),
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'storeCode')).toBe(true);
    });

    it('should fail when email is invalid', async () => {
      const dto = plainToInstance(CreateStoreDto, {
        name: 'Valid',
        email: 'not-an-email',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('should pass with valid email', async () => {
      const dto = plainToInstance(CreateStoreDto, {
        name: 'Valid',
        email: 'store@example.com',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when organizationId is not a UUID', async () => {
      const dto = plainToInstance(CreateStoreDto, {
        name: 'Valid',
        organizationId: 'not-a-uuid',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'organizationId')).toBe(true);
    });

    it('should pass with valid UUID for organizationId', async () => {
      const dto = plainToInstance(CreateStoreDto, {
        name: 'Valid',
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  // ── CreateOrganizationDto ───────────────────────────────────────

  describe('CreateOrganizationDto', () => {
    it('should pass with valid name', async () => {
      const dto = plainToInstance(CreateOrganizationDto, { name: 'Corp Alpha' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when name is empty', async () => {
      const dto = plainToInstance(CreateOrganizationDto, { name: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // ── CreateUnitDto ───────────────────────────────────────────────

  describe('CreateUnitDto', () => {
    const validDto = {
      name: 'Unit Test',
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
    };

    it('should pass with valid data', async () => {
      const dto = plainToInstance(CreateUnitDto, validDto);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when name is missing', async () => {
      const dto = plainToInstance(CreateUnitDto, {
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail when organizationId is missing', async () => {
      const dto = plainToInstance(CreateUnitDto, { name: 'Unit X' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'organizationId')).toBe(true);
    });

    it('should fail when type is invalid', async () => {
      const dto = plainToInstance(CreateUnitDto, {
        ...validDto,
        type: 'invalid-type',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'type')).toBe(true);
    });

    it('should pass with valid type', async () => {
      const dto = plainToInstance(CreateUnitDto, {
        ...validDto,
        type: 'warehouse',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  // ── CreateConnectedAppDto ───────────────────────────────────────

  describe('CreateConnectedAppDto', () => {
    const validDto = {
      name: 'App Test',
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'internal',
    };

    it('should pass with valid data', async () => {
      const dto = plainToInstance(CreateConnectedAppDto, validDto);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when type is invalid', async () => {
      const dto = plainToInstance(CreateConnectedAppDto, {
        ...validDto,
        type: 'cloud',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'type')).toBe(true);
    });
  });
});
