import { describe, expect, it } from 'vitest';
import { validateImageFile, dataUrlBytes, MAX_SOURCE_BYTES } from './imageFile';

const mkFile = (type: string, size: number) => {
  const f = new File([new Uint8Array(1)], 'x', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateImageFile', () => {
  it('accepte JPG/PNG/WebP', () => {
    expect(validateImageFile(mkFile('image/jpeg', 1000))).toBeNull();
    expect(validateImageFile(mkFile('image/png', 1000))).toBeNull();
    expect(validateImageFile(mkFile('image/webp', 1000))).toBeNull();
  });
  it('refuse les autres formats avec un message clair', () => {
    expect(validateImageFile(mkFile('application/pdf', 1000))).toMatch(/Format non pris en charge/);
    expect(validateImageFile(mkFile('image/gif', 1000))).toMatch(/Format non pris en charge/);
    expect(validateImageFile(mkFile('', 1000))).toMatch(/Format non pris en charge/);
  });
  it('refuse un fichier > 8 Mo', () => {
    expect(validateImageFile(mkFile('image/jpeg', MAX_SOURCE_BYTES + 1))).toMatch(/trop volumineux/);
  });
});

describe('dataUrlBytes', () => {
  it('mesure la taille réelle du base64', () => {
    // "AAAA" = 3 octets
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/png;base64,' + 'A'.repeat(4000))).toBe(3000);
  });
});
