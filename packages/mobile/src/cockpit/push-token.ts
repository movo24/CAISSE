/**
 * Cockpit — push-token seam (the client mirror of the server's PUSH_SENDER log
 * floor). Provider ratified: FCM, DEFERRABLE — one integration covers Android +
 * iOS (FCM proxies APNs) + web push. Until it is wired, this returns null: the
 * settings screen shows the "push non configuré" state, registration stays
 * disabled, and the alert FACTS remain fully visible in the Alertes tab — the
 * cockpit ships without the provider, by design.
 *
 * Wiring FCM later = implement getPushToken() with firebase/messaging
 * (getToken(messaging, { vapidKey })) and nothing else changes: the register
 * call, the server surface and the delivery engine are already in place.
 */
export const PUSH_PLATFORM = 'web';

export async function getPushToken(): Promise<string | null> {
  return null; // FCM not wired yet — the floor
}
