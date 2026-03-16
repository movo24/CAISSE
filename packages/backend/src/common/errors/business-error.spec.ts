import { HttpStatus } from '@nestjs/common';
import { BusinessError } from './business-error';

describe('BusinessError', () => {
  describe('notFound', () => {
    it('should create a 404 error with correct code', () => {
      const err = BusinessError.notFound('Store', 'store-123');

      expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(err.code).toBe('STORE_NOT_FOUND');

      const body = err.getResponse() as any;
      expect(body.success).toBe(false);
      expect(body.message).toContain('store-123');
      expect(body.statusCode).toBe(404);
    });
  });

  describe('alreadyExists', () => {
    it('should create a 409 error with correct code', () => {
      const err = BusinessError.alreadyExists('Organization', 'name', 'Corp X');

      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(err.code).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');

      const body = err.getResponse() as any;
      expect(body.success).toBe(false);
      expect(body.message).toContain('Corp X');
    });
  });

  describe('invalidRelation', () => {
    it('should create a 400 error', () => {
      const err = BusinessError.invalidRelation('Org introuvable');

      expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(err.code).toBe('INVALID_RELATION');
    });
  });

  describe('forbidden', () => {
    it('should create a 403 error', () => {
      const err = BusinessError.forbidden('Access denied');

      expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(err.code).toBe('ACCESS_DENIED');
    });
  });

  describe('archived', () => {
    it('should create a 400 error with entity tag', () => {
      const err = BusinessError.archived('Store');

      expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(err.code).toBe('STORE_ARCHIVED');

      const body = err.getResponse() as any;
      expect(body.message).toContain('archiv');
    });
  });

  describe('custom constructor', () => {
    it('should accept details parameter', () => {
      const err = new BusinessError(
        'CUSTOM_ERROR',
        'Something happened',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { field: 'email' },
      );

      expect(err.code).toBe('CUSTOM_ERROR');
      expect(err.details).toEqual({ field: 'email' });
      expect(err.getStatus()).toBe(422);

      const body = err.getResponse() as any;
      expect(body.details).toEqual({ field: 'email' });
    });
  });
});
