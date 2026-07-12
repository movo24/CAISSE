import React from 'react';
import logoUrl from '../assets/wesleys-logo.png';

/**
 * The Wesley's — wordmark de marque (logotype OFFICIEL).
 *
 * Rend le logotype officiel « THE WESLEYS » (PNG transparent haute
 * résolution, importé via Vite → chemin résolu automatiquement en desktop
 * `file://` comme en web). La taille reste pilotée par la `font-size` du
 * conteneur (hauteur = `1.15em`) → le logo scale proprement en unités `vh`,
 * exactement comme l'ancien rendu CSS.
 *
 * `tone` :
 *   - `magenta` (défaut) → logo nu, dans sa couleur de marque (fond clair).
 *   - `light`            → verrou de marque sur pastille blanche arrondie,
 *                          pour les fonds sombres/magenta. (Le logo officiel
 *                          combine plaque magenta + lettres blanches : il ne
 *                          se « blanchit » pas proprement par filtre — la
 *                          pastille blanche garantit contraste et intégrité
 *                          de marque sur n'importe quel fond sombre.)
 *
 * Fallback : si l'image ne charge pas (asset manquant, CSP), on bascule sur
 * un rendu CSS pur du wordmark — l'écran client n'affiche jamais un trou.
 * Ce composant reste le SEUL point d'usage du logotype.
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
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <WordmarkCssFallback tone={tone} className={className} style={style} title={title} />
    );
  }

  const badge = tone === 'light';
  return (
    <span
      className={className}
      role="img"
      aria-label={title}
      style={{
        display: 'inline-flex',
        lineHeight: 0,
        // Verrou de marque sur pastille blanche pour les fonds sombres.
        ...(badge
          ? {
              background: '#ffffff',
              borderRadius: '0.62em',
              padding: '0.34em 0.55em',
              boxShadow: '0 0.16em 0.5em rgba(58,10,34,0.28)',
            }
          : null),
        ...style,
      }}
    >
      <img
        src={logoUrl}
        alt={title}
        draggable={false}
        onError={() => setFailed(true)}
        style={{
          height: '1.15em',
          width: 'auto',
          display: 'block',
          userSelect: 'none',
        }}
      />
    </span>
  );
}

/** Repli CSS pur (offline-first / CSP) si l'asset image est indisponible. */
function WordmarkCssFallback({
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
