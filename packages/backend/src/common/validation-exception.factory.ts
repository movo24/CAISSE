import { BadRequestException, ValidationError } from '@nestjs/common';

/**
 * Transforme les erreurs class-validator en une carte { champ: [messages] },
 * en aplatissant les objets imbriqués (`parent.child`).
 *
 * Objectif : permettre au Back-Office de surligner LE champ fautif au lieu
 * d'afficher un « Erreur de validation » générique (incident création produit
 * 2026-07-21). La liste plate `message` est conservée à l'identique pour la
 * compatibilité avec le GlobalExceptionFilter et les consommateurs existants.
 */
export function collectFieldErrors(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const err of errors) {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;
    if (err.constraints) {
      fields[path] = [...(fields[path] ?? []), ...Object.values(err.constraints)];
    }
    if (err.children?.length) {
      Object.assign(fields, collectFieldErrors(err.children, path));
    }
  }
  return fields;
}

export function validationExceptionFactory(errors: ValidationError[]) {
  const fields = collectFieldErrors(errors);
  return new BadRequestException({
    // Même forme que l'usine par défaut de Nest (message: string[]) —
    // le GlobalExceptionFilter la reconnaît comme erreur de validation.
    message: Object.values(fields).flat(),
    error: 'Bad Request',
    statusCode: 400,
    fields,
  });
}
