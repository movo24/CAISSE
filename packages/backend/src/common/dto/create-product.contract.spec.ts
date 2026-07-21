import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProductDto } from './products.dto';
import {
  validationExceptionFactory,
  collectFieldErrors,
} from '../validation-exception.factory';
import { GTIN_ERROR_MESSAGE, isValidGtin } from '../validators/gtin.validator';

/**
 * Contract test — reproduit la ValidationPipe globale EXACTE de main.ts
 * (whitelist + forbidNonWhitelisted + exceptionFactory structurée) contre
 * CreateProductDto.
 *
 * Contexte : incident « Erreur de validation » à la création produit
 * (2026-07-21). Le Back-Office doit pouvoir surligner le champ fautif :
 * la 400 doit donc exposer `fields: { champ: [messages] }` en plus du
 * tableau plat `message`.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

const meta = { type: 'body' as const, metatype: CreateProductDto };

const validBody = {
  ean: '4006381333931', // EAN-13, clé de contrôle valide
  name: 'Produit test',
  priceMinorUnits: 250,
};

async function fieldsOf(body: Record<string, unknown>): Promise<Record<string, string[]>> {
  try {
    await pipe.transform(body, meta);
    return {};
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as any).fields;
  }
}

describe('CreateProductDto — contrat HTTP création produit', () => {
  it('accepte un produit simple valide (EAN-13, sans catégorie ni champs facultatifs)', async () => {
    const out = await pipe.transform({ ...validBody }, meta);
    expect(out.ean).toBe('4006381333931');
    // catégorie ABSENTE et facultative → aucune erreur
  });

  it('accepte un EAN-8 valide', async () => {
    const out = await pipe.transform({ ...validBody, ean: '96385074' }, meta);
    expect(out.ean).toBe('96385074');
  });

  it('accepte un UPC-A (12 chiffres) valide', async () => {
    const out = await pipe.transform({ ...validBody, ean: '036000291452' }, meta);
    expect(out.ean).toBe('036000291452');
  });

  it.each([
    ['lettres', 'ABC1234567890'],
    ['espaces', '4006 38133 3931'],
    ['longueur invalide (10)', '1234567890'],
    ['clé de contrôle fausse', '4006381333932'],
  ])('refuse un EAN %s avec un message exploitable sur le champ ean', async (_label, ean) => {
    const fields = await fieldsOf({ ...validBody, ean });
    expect(fields.ean).toBeDefined();
    expect(fields.ean).toContain(GTIN_ERROR_MESSAGE);
  });

  it('refuse un EAN vide avec un message dédié', async () => {
    const fields = await fieldsOf({ ...validBody, ean: '' });
    expect(fields.ean).toContain('Le code EAN est obligatoire pour créer un produit.');
  });

  it('expose chaque champ fautif dans `fields` (prix manquant + propriété inconnue)', async () => {
    const { priceMinorUnits: _omit, ...noPrice } = validBody;
    const fields = await fieldsOf({ ...noPrice, legacyField: 'x' });
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(['priceMinorUnits', 'legacyField']),
    );
    // La propriété inconnue reste identifiable telle quelle → le frontend peut
    // détecter un désalignement de version interface/serveur.
    expect(fields.legacyField.join(' ')).toContain('should not exist');
  });

  it('conserve le tableau plat `message` (compatibilité GlobalExceptionFilter)', async () => {
    try {
      await pipe.transform({ ...validBody, priceMinorUnits: -1 }, meta);
      throw new Error('aurait dû rejeter');
    } catch (e) {
      const res = (e as BadRequestException).getResponse() as any;
      expect(Array.isArray(res.message)).toBe(true);
      expect(res.fields.priceMinorUnits).toEqual(res.message);
    }
  });
});

describe('collectFieldErrors — aplatissement imbriqué', () => {
  it('préfixe les enfants par le chemin parent', () => {
    const out = collectFieldErrors([
      {
        property: 'parent',
        children: [
          { property: 'child', constraints: { isInt: 'child must be an integer' }, children: [] } as any,
        ],
      } as any,
    ]);
    expect(out['parent.child']).toEqual(['child must be an integer']);
  });
});

describe('isValidGtin — clé de contrôle', () => {
  it.each([
    ['4006381333931', true],
    ['96385074', true],
    ['036000291452', true],
    ['3760999000777', true], // EAN-13 des tests manuels du 2026-07-19 — clé valide
    ['3760999000778', false],
    ['96385075', false],
    ['', false],
    ['96 385074', false],
  ])('%s → %s', (code, expected) => {
    expect(isValidGtin(code)).toBe(expected);
  });
});
