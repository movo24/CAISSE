// ── pos-ai/store-context.types.ts ───────────────────────────────
// Types for Store Context Enrichment — Intelligence Commerciale IA
// ─────────────────────────────────────────────────────────────────

/** Concurrent local identifie dans la zone */
export interface LocalCompetitor {
  name: string;
  type: string; // ex: "supermarche", "boulangerie", "tabac"
  estimatedDistanceM: number;
}

/** Generateur de trafic dans la zone */
export interface CommercialAttractor {
  name: string;
  type: string; // ex: "gare", "centre_commercial", "universite"
  estimatedDistanceM: number;
}

/** Evenement calendaire (religieux, ferie, culturel) */
export interface CalendarEvent {
  name: string;
  type: 'religious' | 'public_holiday' | 'cultural';
  startDate: string; // ISO date string
  endDate?: string;
  impactDescription: string;
}

/** Contexte calendaire complet pour une date donnee */
export interface CalendarContext {
  religious_events: CalendarEvent[];
  public_holidays: CalendarEvent[];
  school_holidays: boolean;
  cultural_events: CalendarEvent[];
}

/** Analyse de la zone commerciale du magasin (persistee en DB) */
export interface StoreLocationContext {
  zone_type: string; // ex: "centre-ville", "zone commerciale", "gare"
  transport_proximity: string; // ex: "metro ligne 4 a 50m, bus 38 a 100m"
  commercial_environment: string; // ex: "rue pietonne commercante, forte densite"
  traffic_profile: string; // ex: "flux bureau en semaine, touristique le weekend"
  dominant_customer_type: string; // ex: "employes de bureau (60%), touristes (25%)"
  peak_hours_estimated: string[]; // ex: ["7h30-9h", "12h-14h", "17h30-19h30"]
  local_competitors: LocalCompetitor[];
  commercial_attractors: CommercialAttractor[];
  constraints: string[]; // ex: ["flux rapide", "forte concurrence"]
  operational_summary: string; // synthese strategique actionnable
}

/** Contexte complet = localisation + calendaire */
export interface StoreContext extends StoreLocationContext {
  calendar_context: CalendarContext;
}

/** Resultat retourne par l'endpoint d'enrichissement */
export interface StoreContextEnrichmentResult {
  storeId: string;
  context: StoreContext;
  locationAnalysisDate: string; // ISO datetime
  calendarGeneratedAt: string; // ISO datetime
  source: 'gemini' | 'cache' | 'mixed';
}
