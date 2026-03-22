import { useEffect, useRef } from 'react';

/**
 * Keeps the screen awake while the POS is active.
 * Uses Screen Wake Lock API (Safari 16.4+, Chrome 84+).
 * Re-acquires lock when page becomes visible again after tab switch / screen off.
 */
export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let active = true;

    async function requestWakeLock() {
      if (!active) return;
      if (!('wakeLock' in navigator)) {
        console.log('[WakeLock] API not supported — use iPad Guided Access');
        return;
      }
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Screen lock acquired');
        wakeLockRef.current.addEventListener('release', () => {
          console.log('[WakeLock] Released (screen off or tab hidden)');
        });
      } catch (err: any) {
        console.warn('[WakeLock] Failed:', err.message);
      }
    }

    // Re-acquire on visibility change (user returns to app)
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    }

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);
}
