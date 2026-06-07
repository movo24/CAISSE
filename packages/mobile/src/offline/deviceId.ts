/**
 * Identifiant d'appareil stable (persisté localStorage) pour l'audit trail
 * inventaire : chaque comptage offline porte employeeId + storeId + deviceId.
 */
const KEY = 'caisse.deviceId';

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
