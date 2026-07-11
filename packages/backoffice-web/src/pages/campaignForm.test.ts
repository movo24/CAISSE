import { describe, it, expect } from 'vitest';
import {
  EMPTY_CAMPAIGN_FORM,
  parseTerminalIds,
  localToIso,
  isoToLocal,
  validateCampaignForm,
  buildCampaignPayload,
  type CampaignFormState,
} from './campaignForm';

const form = (over: Partial<CampaignFormState> = {}): CampaignFormState => ({
  ...EMPTY_CAMPAIGN_FORM,
  name: 'Promo',
  ...over,
});

describe('campaignForm — parseTerminalIds', () => {
  it('CSV → liste normalisée, dédupliquée', () => {
    expect(parseTerminalIds('01, 02 03,01')).toEqual(['01', '02', '03']);
  });
  it('vide → null', () => {
    expect(parseTerminalIds('')).toBeNull();
    expect(parseTerminalIds('  ,  ')).toBeNull();
  });
});

describe('campaignForm — date round-trip', () => {
  it('localToIso vide → null', () => {
    expect(localToIso('')).toBeNull();
  });
  it('isoToLocal null/invalid → chaîne vide', () => {
    expect(isoToLocal(null)).toBe('');
    expect(isoToLocal('pas-une-date')).toBe('');
  });
  it('round-trip local→iso→local conserve la minute', () => {
    const local = '2026-07-20T14:30';
    const iso = localToIso(local);
    expect(iso).not.toBeNull();
    expect(isoToLocal(iso)).toBe(local);
  });
});

describe('campaignForm — validate', () => {
  it('nom obligatoire', () => {
    expect(validateCampaignForm(form({ name: '  ' }), false)).toMatch(/nom/i);
  });
  it('national réservé admin', () => {
    expect(validateCampaignForm(form({ scope: 'national' }), false)).toMatch(/administrateur/i);
    expect(validateCampaignForm(form({ scope: 'national' }), true)).toBeNull();
  });
  it('priorité entière', () => {
    expect(validateCampaignForm(form({ priority: '1.5' }), false)).toMatch(/entier/i);
    expect(validateCampaignForm(form({ priority: '3' }), false)).toBeNull();
  });
  it('fin > début', () => {
    const bad = form({ startsAt: '2026-07-20T10:00', endsAt: '2026-07-19T10:00' });
    expect(validateCampaignForm(bad, false)).toMatch(/fin/i);
  });
  it('média sans URL', () => {
    const bad = form({ media: [{ type: 'video', url: '', durationSeconds: '' }] });
    expect(validateCampaignForm(bad, false)).toMatch(/URL/i);
  });
  it('durée média invalide', () => {
    const bad = form({ media: [{ type: 'image', url: 'x.png', durationSeconds: '-2' }] });
    expect(validateCampaignForm(bad, false)).toMatch(/durée/i);
  });
  it('formulaire valide → null', () => {
    const ok = form({
      media: [
        { type: 'video', url: 'a.mp4', durationSeconds: '' },
        { type: 'image', url: 'b.png', durationSeconds: '5' },
      ],
    });
    expect(validateCampaignForm(ok, false)).toBeNull();
  });
});

describe('campaignForm — buildCampaignPayload', () => {
  it('mappe les champs et omet la durée vide', () => {
    const p = buildCampaignPayload(
      form({
        priority: '4',
        terminalIdsCsv: '01,02',
        media: [
          { type: 'video', url: ' a.mp4 ', durationSeconds: '' },
          { type: 'image', url: 'b.png', durationSeconds: '5' },
        ],
      }),
    );
    expect(p.name).toBe('Promo');
    expect(p.priority).toBe(4);
    expect(p.terminalIds).toEqual(['01', '02']);
    expect(p.media[0]).toEqual({ type: 'video', url: 'a.mp4' }); // pas de durationSeconds
    expect(p.media[1]).toEqual({ type: 'image', url: 'b.png', durationSeconds: 5 });
  });
  it('priorité vide → 0 ; terminalIds vide → null ; dates vides → null', () => {
    const p = buildCampaignPayload(form({ priority: '', terminalIdsCsv: '' }));
    expect(p.priority).toBe(0);
    expect(p.terminalIds).toBeNull();
    expect(p.startsAt).toBeNull();
    expect(p.endsAt).toBeNull();
  });
});
