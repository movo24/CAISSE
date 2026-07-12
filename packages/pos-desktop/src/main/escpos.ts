/**
 * ESC/POS — séquences d'octets pures (aucune I/O, testables).
 *
 * Utilisées côté desktop pour piloter, via un job RAW au spooler Windows,
 * les fonctions que l'impression HTML ne couvre pas : ouverture du
 * tiroir-caisse et coupe papier. Les valeurs suivent le standard Epson ESC/POS
 * (compatibles avec la quasi-totalité des imprimantes thermiques 58/80 mm).
 */

/** Ouverture tiroir : ESC p m t1 t2 (impulsion sur la broche du connecteur). */
export function drawerKickBytes(pin: 0 | 1 = 0): Uint8Array {
  // ESC p m t1 t2 — m=pin, t1=durée ON (×2 ms), t2=durée OFF (×2 ms).
  // 0x19=25 (~50 ms ON), 0xFA=250 (~500 ms OFF) : valeurs éprouvées.
  return new Uint8Array([0x1b, 0x70, pin === 1 ? 0x01 : 0x00, 0x19, 0xfa]);
}

/** Coupe papier totale : GS V 0. */
export function fullCutBytes(): Uint8Array {
  return new Uint8Array([0x1d, 0x56, 0x00]);
}

/** Coupe papier partielle : GS V 1. */
export function partialCutBytes(): Uint8Array {
  return new Uint8Array([0x1d, 0x56, 0x01]);
}

/** Concatène plusieurs séquences ESC/POS en un seul buffer. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Représentation hex lisible (debug / logs), ex. "1B 70 00 19 FA". */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}
