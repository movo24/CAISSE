/**
 * The Wesley Control — design tokens. Dark-first (mode sombre obligatoire),
 * light palette derived. Colors carry meaning only: gold = brand/accent,
 * green = positive variation, red = negative/critical, amber = warning.
 */
export interface Theme {
  bg: string;
  card: string;
  cardBorder: string;
  text: string;
  muted: string;
  accent: string;
  positive: string;
  negative: string;
  warning: string;
  critical: string;
}

export const darkTheme: Theme = {
  bg: '#0B1220',
  card: '#151E31',
  cardBorder: '#22304C',
  text: '#E8ECF4',
  muted: '#8A94A8',
  accent: '#F0C85A',
  positive: '#3DCC8E',
  negative: '#F0645A',
  warning: '#F0A05A',
  critical: '#F0645A',
};

export const lightTheme: Theme = {
  bg: '#F4F6FA',
  card: '#FFFFFF',
  cardBorder: '#E2E8F2',
  text: '#141C2E',
  muted: '#5D6779',
  accent: '#A87E1B',
  positive: '#118A57',
  negative: '#C23328',
  warning: '#B36A15',
  critical: '#C23328',
};

export function themeFor(scheme: 'dark' | 'light' | null | undefined): Theme {
  return scheme === 'light' ? lightTheme : darkTheme;
}
