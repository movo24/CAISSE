import React from 'react';

/**
 * ADDX — wordmark de marque (logotype ADDX Caisse POS).
 *
 * Aucun asset ADDX n'existe dans le repo ; le logo est rendu en **inline SVG**
 * (net à toute taille, offline/CSP-safe, jamais de trou). Il reprend la marque
 * de la maquette : « ADD » dans la couleur courante (blanc sur header sombre) et
 * un « X » rouge de marque. La taille suit la `font-size`/hauteur du conteneur.
 *
 * Seul point d'usage du logotype ADDX — ne pas dupliquer le SVG ailleurs.
 */
export function AddxWordmark({
  className,
  style,
  title = 'ADDX',
  accent = '#ff2d55',
}: {
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /** Couleur du « X » (rouge de marque par défaut). */
  accent?: string;
}) {
  return (
    <svg
      className={className}
      style={style}
      role="img"
      aria-label={title}
      viewBox="0 0 132 34"
      height="1em"
      width="auto"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <text
        x="0"
        y="27"
        fontFamily="-apple-system, 'Segoe UI', system-ui, sans-serif"
        fontSize="32"
        fontWeight="900"
        letterSpacing="-1"
        fill="currentColor"
      >
        ADD
      </text>
      <text
        x="97"
        y="27"
        fontFamily="-apple-system, 'Segoe UI', system-ui, sans-serif"
        fontSize="32"
        fontWeight="900"
        letterSpacing="-1"
        fill={accent}
      >
        X
      </text>
    </svg>
  );
}
