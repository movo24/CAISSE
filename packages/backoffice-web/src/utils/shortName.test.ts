import { describe, expect, it } from 'vitest';
import { suggestShortName, shouldAutoFillShortName, SHORT_NAME_TARGET } from './shortName';

describe('suggestShortName', () => {
  it('exemple owner : gel douche Dove', () => {
    const s = suggestShortName('Gel douche Dove soin nourrissant 500 ml', 'Dove', 24);
    expect(s).toBe('Dove Gel douche 500ml');
  });

  it('exemple owner : Coca-Cola 1,25 litre', () => {
    const s = suggestShortName('Coca-Cola goût original bouteille 1,25 litre', null, 25);
    expect(s).toBe('Coca-Cola original 1,25L');
  });

  it('nom court : inchangé (hors compaction unités)', () => {
    expect(suggestShortName('Coca 33cl')).toBe('Coca 33cl');
    expect(suggestShortName('Twix 50 g')).toBe('Twix 50g');
  });

  it('jamais de coupe au milieu d’un mot', () => {
    const s = suggestShortName('Chocolat noir intense dégustation grand cru équitable 100 g', null, 30);
    expect(s.length).toBeLessThanOrEqual(30);
    // chaque mot du résultat existe tel quel dans la source normalisée
    for (const w of s.split(' ')) {
      expect('Chocolat noir intense dégustation grand cru équitable 100g'.split(' ')).toContain(w);
    }
  });

  it('préserve la contenance finale quand il faut raccourcir', () => {
    const s = suggestShortName('Jus d’orange pressée sans pulpe premium qualité supérieure 1L', null, 24);
    expect(s.endsWith('1L')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(24);
  });

  it('promotion de la marque en tête si connue', () => {
    const s = suggestShortName('Shampooing doux Head & Shoulders citron 285 ml', 'Head & Shoulders', 32);
    expect(s.startsWith('Head & Shoulders')).toBe(true);
  });

  it('respecte la limite par défaut', () => {
    const s = suggestShortName('Assortiment de bonbons gélifiés aux fruits rouges édition limitée maxi format familial 1 kg');
    expect(s.length).toBeLessThanOrEqual(SHORT_NAME_TARGET);
    expect(s.length).toBeGreaterThan(0);
  });

  it('entrées vides', () => {
    expect(suggestShortName('')).toBe('');
    expect(suggestShortName('   ')).toBe('');
  });
});

describe('shouldAutoFillShortName', () => {
  it('remplit un champ vide', () => {
    expect(shouldAutoFillShortName('', 'Coca 33cl')).toBe(true);
  });
  it('suit tant que la valeur = dernière suggestion', () => {
    expect(shouldAutoFillShortName('Coca 33cl', 'Coca 33cl')).toBe(true);
  });
  it('n’écrase jamais une saisie manuelle', () => {
    expect(shouldAutoFillShortName('Mon libellé à moi', 'Coca 33cl')).toBe(false);
  });
});
