import React from 'react';

/**
 * Logo officiel ADDX — rend le FICHIER fourni par l'owner, tel quel.
 *
 * RÈGLE OWNER (design V1 validé) : le logo n'est JAMAIS recréé, dessiné ou
 * approximé dans le code — uniquement l'asset officiel
 * `src/renderer/assets/addx-logo.png`. Tant que le fichier n'est pas déposé
 * dans le repo, le slot reste VIDE (aucun substitut) : `import.meta.glob`
 * résout l'asset s'il existe sans faire échouer le build s'il manque, et le
 * logo apparaît automatiquement dès que le fichier officiel est ajouté.
 */
const logoModules = import.meta.glob('../assets/addx-logo.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const logoUrl = logoModules['../assets/addx-logo.png'];

export function AddxWordmark({
  className,
  style,
  title = 'ADDX',
}: {
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  // Fichier officiel pas encore déposé → slot vide, jamais de logo substitut.
  if (!logoUrl) return null;
  return (
    <img
      src={logoUrl}
      alt={title}
      draggable={false}
      className={className}
      style={{ height: 34, width: 'auto', display: 'block', userSelect: 'none', ...style }}
    />
  );
}
