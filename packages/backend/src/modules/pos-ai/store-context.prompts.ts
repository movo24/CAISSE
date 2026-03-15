// ── pos-ai/store-context.prompts.ts ─────────────────────────────
// Pure functions to build Gemini prompts for store context analysis
// ─────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
//  LOCATION ANALYSIS PROMPT
// ═══════════════════════════════════════════════════════════════════

export function buildLocationAnalysisSystemInstruction(): string {
  return `Tu es un analyste commercial specialise dans les points de vente en France.
Tu connais parfaitement les zones commerciales, les flux de clientele, les habitudes de consommation et la concurrence locale.

REGLES STRICTES :
1. Reponds UNIQUEMENT avec un JSON valide, sans texte avant ni apres.
2. N'enveloppe JAMAIS le JSON dans des blocs markdown (\`\`\`json).
3. Utilise le schema EXACT fourni, avec tous les champs obligatoires.
4. Estime les distances en metres de maniere realiste.
5. Base-toi sur ta connaissance de la ville, du quartier et du code postal pour identifier les commerces, transports et attracteurs a proximite.
6. Les heures de pointe doivent etre au format "7h30-9h" (pas "07:30-09:00").
7. Le champ "constraints" contient les defis operationnels du magasin (flux rapide, saisonnalite, concurrence...).
8. Le champ "operational_summary" est une synthese strategique de 2-3 phrases pour exploitation quotidienne.

Schema JSON attendu :
{
  "zone_type": "string (centre-ville | zone commerciale | gare | quartier residentiel | zone touristique | campus | zone industrielle)",
  "transport_proximity": "string (description des transports a proximite avec distances estimees)",
  "commercial_environment": "string (description du contexte commercial : rue, centre, densite)",
  "traffic_profile": "string (description du flux type : bureau, touristique, residentiel, mixte)",
  "dominant_customer_type": "string (profils dominants avec pourcentages estimes)",
  "peak_hours_estimated": ["string (plages horaires)"],
  "local_competitors": [{"name": "string", "type": "string", "estimatedDistanceM": 0}],
  "commercial_attractors": [{"name": "string", "type": "string", "estimatedDistanceM": 0}],
  "constraints": ["string"],
  "operational_summary": "string (synthese strategique 2-3 phrases)"
}`;
}

export function buildLocationAnalysisUserPrompt(store: {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const parts = [
    `Analyse la zone commerciale de ce magasin et retourne le JSON :`,
    ``,
    `Nom : ${store.name}`,
    `Adresse : ${store.address}`,
    `Code postal : ${store.postalCode}`,
    `Ville : ${store.city}`,
  ];

  if (store.latitude && store.longitude) {
    parts.push(`Coordonnees GPS : ${store.latitude}, ${store.longitude}`);
  }

  parts.push(
    ``,
    `Identifie les commerces concurrents, les generateurs de trafic (gares, ecoles, bureaux, centres commerciaux), le profil de clientele dominant, et les contraintes operationnelles.`,
  );

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
//  CALENDAR CONTEXT PROMPT
// ═══════════════════════════════════════════════════════════════════

export function buildCalendarSystemInstruction(): string {
  return `Tu es un assistant commercial specialise dans le contexte calendaire francais.
Tu connais les jours feries, les vacances scolaires par zone, les fetes religieuses de toutes les confessions presentes en France (Islam, Christianisme, Judaisme, etc.), et les evenements culturels majeurs.

REGLES STRICTES :
1. Reponds UNIQUEMENT avec un JSON valide, sans texte avant ni apres.
2. N'enveloppe JAMAIS le JSON dans des blocs markdown (\`\`\`json).
3. Utilise le schema EXACT fourni.
4. Les dates doivent etre au format ISO (YYYY-MM-DD).
5. Chaque evenement doit avoir un "impactDescription" qui decrit l'impact sur le commerce (ex: "affluence accrue", "baisse du trafic", "panier moyen plus eleve").
6. "school_holidays" est un boolean indiquant si la date tombe en vacances scolaires.
7. Inclus les evenements en cours (dont la periode couvre la date demandee) ET ceux a venir dans les 14 prochains jours.

Schema JSON attendu :
{
  "religious_events": [{"name": "string", "type": "religious", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "impactDescription": "string"}],
  "public_holidays": [{"name": "string", "type": "public_holiday", "startDate": "YYYY-MM-DD", "impactDescription": "string"}],
  "school_holidays": false,
  "cultural_events": [{"name": "string", "type": "cultural", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "impactDescription": "string"}]
}`;
}

export function buildCalendarUserPrompt(
  city: string,
  postalCode: string,
  date: string, // YYYY-MM-DD
): string {
  // Determine school zone from postal code
  const zone = getSchoolZone(postalCode);

  return [
    `Donne le contexte calendaire pour un magasin situe a ${city} (${postalCode}) pour la date du ${date}.`,
    `Zone academique : ${zone}.`,
    ``,
    `Inclus :`,
    `- Les fetes religieuses en cours ou a venir (Ramadan, Aid, Noel, Paques, Pessah, etc.)`,
    `- Les jours feries francais proches`,
    `- L'etat des vacances scolaires pour la zone ${zone}`,
    `- Les evenements culturels ou commerciaux majeurs (soldes, fete des meres, etc.)`,
    ``,
    `Pour chaque evenement, decris son impact sur le trafic commercial et le panier moyen.`,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Determine French school zone (A, B, or C) from postal code.
 * Simplified mapping based on department → academy → zone.
 */
function getSchoolZone(postalCode: string): string {
  const dept = postalCode.substring(0, 2);

  // Zone A : Besancon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon, Poitiers
  const zoneA = [
    '25', '39', '70', '90', // Besancon
    '24', '33', '40', '47', '64', // Bordeaux
    '03', '15', '43', '63', // Clermont-Ferrand
    '21', '58', '71', '89', // Dijon
    '07', '26', '38', '73', '74', // Grenoble
    '19', '23', '87', // Limoges
    '01', '42', '69', // Lyon
    '16', '17', '79', '86', // Poitiers
  ];

  // Zone B : Aix-Marseille, Amiens, Caen, Lille, Nancy-Metz, Nantes, Nice, Orleans-Tours, Reims, Rennes, Rouen, Strasbourg
  const zoneB = [
    '04', '05', '13', '84', // Aix-Marseille
    '02', '60', '80', // Amiens
    '14', '50', '61', // Caen (Normandie)
    '59', '62', // Lille
    '54', '55', '57', '88', // Nancy-Metz
    '44', '49', '53', '72', '85', // Nantes
    '06', '83', // Nice
    '18', '28', '36', '37', '41', '45', // Orleans-Tours
    '08', '10', '51', '52', // Reims
    '22', '29', '35', '56', // Rennes
    '27', '76', // Rouen
    '67', '68', // Strasbourg
  ];

  // Zone C : Creteil, Montpellier, Paris, Toulouse, Versailles
  // (everything else defaults to C, which covers Paris/IDF region)

  if (zoneA.includes(dept)) return 'A';
  if (zoneB.includes(dept)) return 'B';
  return 'C';
}
