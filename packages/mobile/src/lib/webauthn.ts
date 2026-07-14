// ── Passkeys WebAuthn/FIDO2 (client) ─────────────────────────────
// Exclusivement WebAuthn : la biométrie (Face ID / Touch ID / Windows
// Hello / Android) est gérée par l'OS. Aucune caméra, aucune photo,
// aucune donnée biométrique ne transite ni n'est stockée — et AUCUNE
// credential n'est écrite dans le localStorage : tout vit dans
// l'authenticator de l'appareil et côté serveur (clé publique).
// ─────────────────────────────────────────────────────────────────

import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { webauthnApi } from '../services/api';

export interface PasskeySupport {
  available: boolean;
  /** Libellé honnête : « Face ID »/« Touch ID » seulement quand la
   *  plateforme est raisonnablement identifiable, sinon générique. */
  label: string;
  buttonLabel: string;
}

export async function detectPasskeySupport(): Promise<PasskeySupport> {
  const generic: PasskeySupport = {
    available: false,
    label: 'clé d’accès',
    buttonLabel: 'Se connecter avec une clé d’accès',
  };
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return generic;

  let available = true;
  try {
    // Plateforme (Face ID / Touch ID / Hello / Android) OU clé de sécurité
    // externe : WebAuthn reste utilisable même sans authenticator plateforme.
    await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    /* l'API existe : on laisse WebAuthn tenter (clé FIDO2 externe possible) */
  }

  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/(Macintosh)/.test(ua) && navigator.maxTouchPoints > 1);
  const isMac = /Macintosh/.test(ua) && !isIos;
  if (isIos) {
    return { available, label: 'Face ID', buttonLabel: 'Se connecter avec Face ID' };
  }
  if (isMac) {
    return { available, label: 'Touch ID', buttonLabel: 'Se connecter avec Touch ID' };
  }
  return { ...generic, available };
}

/** Nom d'appareil proposé par défaut (« iPhone d'Omar », « PC du bureau »). */
export function suggestDeviceName(firstName?: string): string {
  const ua = navigator.userAgent;
  const owner = firstName ? ` d'${firstName}` : '';
  if (/iPhone/.test(ua)) return `iPhone${owner}`;
  if (/iPad/.test(ua)) return `iPad${owner}`;
  if (/Macintosh/.test(ua)) return `Mac${owner}`;
  if (/Windows/.test(ua)) return `PC${owner || ' du bureau'}`;
  if (/Android/.test(ua)) return `Android${owner}`;
  return `Appareil${owner}`;
}

/** L'utilisateur a annulé la fenêtre Face ID / clé d'accès de l'OS. */
export function isUserCancellation(e: any): boolean {
  return e?.name === 'NotAllowedError' || e?.name === 'AbortError';
}

/** Enregistre une passkey pour le compte COURANT (JWT requis). */
export async function registerPasskey(deviceName: string) {
  const { data: options } = await webauthnApi.registerOptions();
  const response = await startRegistration({ optionsJSON: options });
  const { data } = await webauthnApi.registerVerify({ response, deviceName });
  return data;
}

/** Connexion par passkey découvrable (sans email) → session serveur. */
export async function loginWithPasskey() {
  const { data } = await webauthnApi.loginOptions();
  const response = await startAuthentication({ optionsJSON: data.options });
  const { data: session } = await webauthnApi.loginVerify({
    challengeId: data.challengeId,
    response,
  });
  return session;
}
