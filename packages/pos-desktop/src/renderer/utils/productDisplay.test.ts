import { describe, expect, it } from 'vitest';
import { productDisplayName, productMatchesQuery } from './productDisplay';

describe('productDisplayName — nom court caisse (GO 2026-07-19)', () => {
  it('utilise shortName quand il existe', () => {
    expect(
      productDisplayName({ name: 'Gel douche Dove soin nourrissant 500 ml', shortName: 'Dove Gel douche 500ml' }),
    ).toBe('Dove Gel douche 500ml');
  });

  it('retombe sur name quand shortName est absent, null ou vide', () => {
    expect(productDisplayName({ name: 'Coca-Cola 33cl' })).toBe('Coca-Cola 33cl');
    expect(productDisplayName({ name: 'Coca-Cola 33cl', shortName: null })).toBe('Coca-Cola 33cl');
    expect(productDisplayName({ name: 'Coca-Cola 33cl', shortName: '' })).toBe('Coca-Cola 33cl');
    expect(productDisplayName({ name: 'Coca-Cola 33cl', shortName: '   ' })).toBe('Coca-Cola 33cl');
  });
});

describe('productMatchesQuery — recherche produit', () => {
  const p = {
    name: 'Gel douche Dove soin nourrissant 500 ml',
    shortName: 'Dove Gel douche 500ml',
    ean: '3760999000999',
    description: null,
    categoryId: 'hygiene-id',
  };

  it('matche sur le nom complet (non-régression)', () => {
    expect(productMatchesQuery(p, 'nourrissant')).toBe(true);
  });
  it('matche sur le NOM COURT', () => {
    expect(productMatchesQuery(p, 'dove gel')).toBe(true);
  });
  it('matche sur l’EAN (non-régression)', () => {
    expect(productMatchesQuery(p, '3760999000999')).toBe(true);
  });
  it('ne matche pas une requête étrangère', () => {
    expect(productMatchesQuery(p, 'twix')).toBe(false);
  });
  it('shortName vide ne matche pas la requête vide résiduelle', () => {
    expect(productMatchesQuery({ ...p, shortName: '  ' }, 'zzz')).toBe(false);
  });
});

describe('productMatchesQuery — identifiants internes Wesley (Code 128, non-GS1)', () => {
  const vrac = {
    name: 'Bonbons vrac maison',
    shortName: 'Vrac maison',
    ean: 'WES-P-000000000042',
    description: null,
    categoryId: 'vrac-id',
  };

  it('retrouve le produit par son code Wesley complet — requête normalisée en minuscules par l’appelant', () => {
    // useCart/POSPage passent `value.toLowerCase().trim()` : le code interne
    // doit matcher malgré la casse (bug latent corrigé — `ean.includes` était
    // sensible à la casse, indifférent pour un EAN numérique, bloquant pour WES-P).
    expect(productMatchesQuery(vrac, 'wes-p-000000000042')).toBe(true);
  });

  it('retrouve le produit par un fragment du code Wesley (saisie partielle)', () => {
    expect(productMatchesQuery(vrac, 'wes-p-0000000000')).toBe(true);
  });

  it('retrouve toujours le produit par nom / nom court', () => {
    expect(productMatchesQuery(vrac, 'vrac maison')).toBe(true);
  });
});
