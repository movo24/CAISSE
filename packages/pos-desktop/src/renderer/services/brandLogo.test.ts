import { describe, expect, it } from 'vitest';
import { isPrintableLogoDataUrl, getBrandLogoDataUrl, resolveReceiptLogo } from './brandLogo';
import { WESLEY_RECEIPT_LOGO_DATA_URL } from '../assets/wesleyReceiptLogo';

describe('isPrintableLogoDataUrl', () => {
  it('accepte une data-URL PNG/JPEG base64', () => {
    expect(isPrintableLogoDataUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isPrintableLogoDataUrl('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isPrintableLogoDataUrl('data:image/jpg;base64,AAAA')).toBe(true);
  });
  it('refuse tout ce qui ne s’imprime pas dans la fenêtre data:text/html', () => {
    expect(isPrintableLogoDataUrl('https://cdn.example.com/logo.png')).toBe(false);
    expect(isPrintableLogoDataUrl('app://app/assets/logo.png')).toBe(false);
    expect(isPrintableLogoDataUrl('/assets/logo.png')).toBe(false);
    expect(isPrintableLogoDataUrl('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isPrintableLogoDataUrl('')).toBe(false);
    expect(isPrintableLogoDataUrl(null)).toBe(false);
    expect(isPrintableLogoDataUrl(undefined)).toBe(false);
  });
});

describe('logo officiel embarqué (constante data-URL, dans le bundle)', () => {
  it('WESLEY_RECEIPT_LOGO_DATA_URL est un vrai PNG base64 imprimable', () => {
    expect(WESLEY_RECEIPT_LOGO_DATA_URL.startsWith('data:image/png;base64,')).toBe(true);
    expect(isPrintableLogoDataUrl(WESLEY_RECEIPT_LOGO_DATA_URL)).toBe(true);
    // Un vrai PNG encodé pèse largement plus que quelques octets.
    expect(WESLEY_RECEIPT_LOGO_DATA_URL.length).toBeGreaterThan(1000);
  });
  it('getBrandLogoDataUrl renvoie cette data-URL, synchrone, sans fetch', () => {
    expect(getBrandLogoDataUrl()).toBe(WESLEY_RECEIPT_LOGO_DATA_URL);
  });
});

describe('resolveReceiptLogo — config magasin vs repli embarqué', () => {
  it('utilise le logo magasin quand c’est une data-URL imprimable', () => {
    const store = 'data:image/png;base64,ZZZZ';
    expect(resolveReceiptLogo(store)).toBe(store);
  });
  it('IGNORE un logo magasin non imprimable et retombe sur l’embarqué (jamais « pas de logo »)', () => {
    const embedded = WESLEY_RECEIPT_LOGO_DATA_URL;
    expect(resolveReceiptLogo('https://cdn.example.com/logo.png')).toBe(embedded);
    expect(resolveReceiptLogo('data:image/svg+xml;base64,AAAA')).toBe(embedded);
    expect(resolveReceiptLogo(null)).toBe(embedded);
    expect(resolveReceiptLogo(undefined)).toBe(embedded);
    expect(resolveReceiptLogo('')).toBe(embedded);
  });
});
