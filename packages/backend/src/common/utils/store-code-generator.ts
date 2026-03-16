/**
 * Store Code Generator
 *
 * Generates human-readable, unique store codes from the store name and city.
 * Format: PREFIX-LOCATION-NNN
 *
 * Examples:
 *   "Boutique Opera", "Paris"        → BOU-PARIS-001
 *   "Westhouse Cergy", "Cergy"       → WES-CERGY-001
 *   "Magasin Principal", undefined    → MAG-001
 *   "Le Comptoir du Style", "Lyon"   → LCD-LYON-001
 *
 * Rules:
 *   - Prefix: first 3 uppercase consonants of the name (fallback: first 3 chars)
 *   - Location: first 5 uppercase chars of the city (if provided)
 *   - Sequence: 3-digit counter for uniqueness
 *   - ASCII only, no accents
 */

/** Remove accents and normalize to ASCII */
function removeAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
}

/** Extract a prefix from the store name */
function extractPrefix(name: string): string {
  const clean = removeAccents(name).toUpperCase();

  // Try to get 3 consonants
  const consonants = clean.replace(/[AEIOUY\d]/g, '');
  if (consonants.length >= 3) return consonants.slice(0, 3);

  // Fallback: first 3 alphanumeric characters
  return clean.slice(0, 3).padEnd(3, 'X');
}

/** Extract a location tag from the city */
function extractLocation(city?: string): string | null {
  if (!city || city.trim().length === 0) return null;
  return removeAccents(city).toUpperCase().slice(0, 5);
}

/**
 * Generate a store code candidate.
 * The caller must check uniqueness and increment `sequence` if needed.
 */
export function generateStoreCode(
  name: string,
  city?: string,
  sequence = 1,
): string {
  const prefix = extractPrefix(name);
  const location = extractLocation(city);
  const seq = String(sequence).padStart(3, '0');

  if (location) {
    return `${prefix}-${location}-${seq}`;
  }
  return `${prefix}-${seq}`;
}

/**
 * Generate a unique store code by checking against existing codes.
 * Tries up to 100 sequence numbers before failing.
 */
export async function generateUniqueStoreCode(
  name: string,
  city: string | undefined,
  existsChecker: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let seq = 1; seq <= 999; seq++) {
    const code = generateStoreCode(name, city, seq);
    const exists = await existsChecker(code);
    if (!exists) return code;
  }
  // Extremely unlikely — fallback to timestamp-based code
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  return `STR-${ts}`;
}
