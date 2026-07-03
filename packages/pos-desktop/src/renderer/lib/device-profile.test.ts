/**
 * P363 — POS-019 : classifieurs PURS du profil terminal (config persistée
 * par terminal-id, déjà testée — ici : classes d'écran et classes CSS).
 * Le critère d'acceptation « config persistée » est couvert par
 * terminal-id.test.ts ; ce spec verrouille le classement responsive
 * dont dépendent les layouts iPad/desktop du POS.
 */
import { describe, it, expect } from 'vitest';
import {
  getScreenClass,
  platformClasses,
  DeviceProfile,
} from '../hooks/useDeviceProfile';

describe('POS-019 — getScreenClass (bornes exactes : compact ≤1024 < standard < 1440 ≤ wide)', () => {
  it('classe les largeurs clés du parc (iPad portrait/paysage, FullHD)', () => {
    expect(getScreenClass(810)).toBe('compact'); // iPad portrait
    expect(getScreenClass(1024)).toBe('compact'); // iPad paysage — borne incluse
    expect(getScreenClass(1025)).toBe('standard');
    expect(getScreenClass(1439)).toBe('standard');
    expect(getScreenClass(1440)).toBe('wide'); // borne incluse
    expect(getScreenClass(1920)).toBe('wide'); // FullHD caisse Windows
  });
});

describe('POS-019 — platformClasses (contrat CSS des layouts)', () => {
  const profile: DeviceProfile = {
    platform: 'ipad',
    inputMode: 'touch',
    screenClass: 'compact',
    isTouch: true,
    isElectron: false,
    isPWA: true,
    isLandscape: false,
    viewportWidth: 810,
    viewportHeight: 1080,
    hasCamera: true,
  } as DeviceProfile;

  it('émet les 3 classes de base + drapeaux actifs uniquement', () => {
    const cls = platformClasses(profile).split(' ');
    expect(cls).toEqual(
      expect.arrayContaining(['platform-ipad', 'input-touch', 'screen-compact', 'is-touch', 'is-pwa']),
    );
    expect(cls).not.toContain('is-electron');
    expect(cls).not.toContain('is-landscape');
  });

  it('profil desktop Electron paysage : drapeaux inversés', () => {
    const cls = platformClasses({
      ...profile, platform: 'windows', inputMode: 'mouse', screenClass: 'wide',
      isTouch: false, isElectron: true, isPWA: false, isLandscape: true,
    } as DeviceProfile);
    expect(cls).toContain('is-electron');
    expect(cls).toContain('is-landscape');
    expect(cls).not.toContain('is-touch');
    expect(cls).toContain('platform-windows input-mouse screen-wide'.split(' ')[0]);
  });
});
