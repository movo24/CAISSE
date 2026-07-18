/**
 * Construction PURE des paramètres de listing des sessions caisse.
 *
 * Règle serveur (pos-session.controller.ts) : seul un ADMIN peut cibler un
 * autre magasin via `?storeId=` ; pour tout autre rôle, le TenantInterceptor
 * BLOQUE un `storeId` de query différent du JWT. On n'envoie donc `storeId`
 * que pour un admin ayant explicitement choisi un magasin — jamais autrement
 * (chaîne vide = « mon magasin », on laisse le serveur retomber sur le JWT).
 */
export interface SessionListParams {
  limit: number;
  withCashCountOnly: boolean;
  storeId?: string;
}

export function buildSessionListParams(opts: {
  isAdmin: boolean;
  selectedStoreId: string;
  withCashCountOnly: boolean;
  limit?: number;
}): SessionListParams {
  const params: SessionListParams = {
    limit: opts.limit ?? 100,
    withCashCountOnly: opts.withCashCountOnly,
  };
  const chosen = opts.selectedStoreId.trim();
  if (opts.isAdmin && chosen) params.storeId = chosen;
  return params;
}
