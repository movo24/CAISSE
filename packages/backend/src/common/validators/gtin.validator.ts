import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validation d'un code-barres GTIN (EAN-8, UPC-A 12, EAN-13) :
 * uniquement des chiffres, longueur 8/12/13, clé de contrôle mod-10 valide.
 *
 * Toute autre longueur (ou lettres/espaces) est refusée — un code mal scanné
 * ou mal saisi doit produire une erreur *explicite*, jamais un enregistrement
 * silencieusement faux (le POS matche les ventes sur ce code).
 */
export function isValidGtin(code: string): boolean {
  if (typeof code !== 'string') return false;
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  // Mod-10 GTIN : en partant du chiffre le plus à droite (hors clé),
  // poids alternés 3, 1, 3, 1…
  let sum = 0;
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

export const GTIN_ERROR_MESSAGE =
  'Code EAN invalide : 8 ou 13 chiffres attendus (sans lettres ni espaces), avec une clé de contrôle valide.';

/** Décorateur class-validator — à poser sur un champ code-barres. */
export function IsGtinBarcode(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGtinBarcode',
      target: object.constructor,
      propertyName,
      options: { message: GTIN_ERROR_MESSAGE, ...validationOptions },
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidGtin(value.trim());
        },
      },
    });
  };
}
