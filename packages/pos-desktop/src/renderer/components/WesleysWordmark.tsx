import React from 'react';

/**
 * The Wesley's — wordmark de marque (logotype).
 *
 * Reproduit le logotype « THE WESLEYS » (petit « THE » posé sur un gros
 * « WESLEYS » arrondi et gras) en pur CSS, sans dépendre d'une police externe
 * (l'app est offline-first + CSP stricte). La taille est pilotée par la
 * `font-size` du conteneur → le logo scale proprement en unités `vh`.
 *
 * NOTE : pour utiliser le logo OFFICIEL vectoriel, déposer le SVG/PNG dans
 * `public/assets/wesleys-logo.svg` et remplacer le rendu ci-dessous par une
 * simple <img>. Le reste de l'UI n'a pas à changer (ce composant est le seul
 * point d'usage du logotype).
 */

const ROUNDED_STACK =
  '"Baloo 2", "Fredoka", "Nunito", "Quicksand", "Trebuchet MS", system-ui, sans-serif';

export function WesleysWordmark({
  tone = 'magenta',
  className,
  style,
  title = "The Wesley's",
}: {
  tone?: 'magenta' | 'light';
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const color = tone === 'light' ? '#ffffff' : '#E5117A';
  return (
    <div
      className={className}
      role="img"
      aria-label={title}
      style={{
        position: 'relative',
        display: 'inline-block',
        lineHeight: 0.9,
        color,
        fontFamily: ROUNDED_STACK,
        ...style,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '-0.52em',
          left: '0.06em',
          fontSize: '0.30em',
          fontWeight: 800,
          letterSpacing: '0.22em',
        }}
      >
        THE
      </span>
      <span style={{ fontSize: '1em', fontWeight: 900, letterSpacing: '-0.02em' }}>
        WESLEYS
      </span>
    </div>
  );
}
