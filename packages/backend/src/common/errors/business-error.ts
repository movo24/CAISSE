import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Standardized business error for the CAISSE API.
 *
 * Every BusinessError produces a JSON response of the form:
 * ```json
 * {
 *   "success": false,
 *   "code": "STORE_CODE_ALREADY_EXISTS",
 *   "message": "Le code magasin existe déjà.",
 *   "statusCode": 409,
 *   "details": { ... }   // optional
 * }
 * ```
 *
 * Use the static factory methods for common cases, or instantiate directly
 * for one-off domain errors.
 */
export class BusinessError extends HttpException {
  readonly code: string;
  readonly details?: any;

  constructor(
    code: string,
    message: string,
    statusCode: HttpStatus,
    details?: any,
  ) {
    const body = {
      success: false,
      code,
      message,
      statusCode,
      ...(details !== undefined ? { details } : {}),
    };
    super(body, statusCode);
    this.code = code;
    this.details = details;
  }

  // ── Factory methods ────────────────────────────────────────────────

  /** 404 — entity with the given id was not found. */
  static notFound(entity: string, id: string): BusinessError {
    const tag = entity.toUpperCase().replace(/\s+/g, '_');
    return new BusinessError(
      `${tag}_NOT_FOUND`,
      `${entity} avec l'identifiant « ${id} » est introuvable.`,
      HttpStatus.NOT_FOUND,
    );
  }

  /** 409 — a unique constraint on `field` is violated. */
  static alreadyExists(
    entity: string,
    field: string,
    value: string,
  ): BusinessError {
    const tag = entity.toUpperCase().replace(/\s+/g, '_');
    const fieldTag = field.toUpperCase().replace(/\s+/g, '_');
    return new BusinessError(
      `${tag}_${fieldTag}_ALREADY_EXISTS`,
      `${entity} avec ${field} « ${value} » existe déjà.`,
      HttpStatus.CONFLICT,
    );
  }

  /** 400 — a referenced relation is invalid or missing. */
  static invalidRelation(message: string): BusinessError {
    return new BusinessError(
      'INVALID_RELATION',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  /** 403 — the caller is not allowed to perform this action. */
  static forbidden(message: string): BusinessError {
    return new BusinessError(
      'ACCESS_DENIED',
      message,
      HttpStatus.FORBIDDEN,
    );
  }

  /** 400 — the entity has been archived and cannot be mutated. */
  static archived(entity: string): BusinessError {
    const tag = entity.toUpperCase().replace(/\s+/g, '_');
    return new BusinessError(
      `${tag}_ARCHIVED`,
      `${entity} est archivé(e) et ne peut pas être modifié(e).`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
