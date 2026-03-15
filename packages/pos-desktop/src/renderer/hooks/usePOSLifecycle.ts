import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePOSStore } from '../stores/posStore';
import { useDeviceProfile } from './useDeviceProfile';
import { occupancyApi, weatherApi } from '../services/api';
import { useStaffingStore } from '../services/staffingEngine';
import { useComparisonStore } from '../stores/comparisonStore';
import { posEventBus } from '../services/posEventBus';
import { peripheralBridge } from '../services/peripheralBridge';
import { useCloudSyncStore } from '../services/cloudSyncIdentity';
import { useRights } from './useRights';

/**
 * Hook for POS lifecycle management.
 * Extracted from POSPage.tsx to be shared between Desktop and iPad layouts.
 *
 * Handles:
 * - Redirect if not logged in
 * - Staffing engine start/stop + SESSION_OPENED event
 * - Network comparison polling
 * - Peripheral bridge init
 * - Cloud sync identity
 * - Occupancy + weather polling (30s interval)
 * - Keyboard shortcuts (F2, F5, F8, F9, Escape)
 */
export function usePOSLifecycle(options?: {
  onF9?: () => void;
  onEscape?: () => boolean; // return true if handled
}) {
  const store = usePOSStore();
  const device = useDeviceProfile();
  const rights = useRights();
  const navigate = useNavigate();
  const cloudSync = useCloudSyncStore();

  // Redirect if not logged in
  useEffect(() => {
    if (!store.employee) navigate('/');
  }, [store.employee, navigate]);

  // Start/stop staffing engine + emit SESSION_OPENED
  useEffect(() => {
    const staffing = useStaffingStore.getState();
    const storeId = store.storeInfo?.siret || store.employee?.storeId || 'unknown';
    staffing.loadPersistedData();
    staffing.start(storeId);

    // Register current cashier + emit event
    if (store.employee) {
      const name = `${store.employee.firstName} ${store.employee.lastName}`;
      staffing.registerCashier(store.employee.id, name);
      posEventBus.emit('SESSION_OPENED', {
        storeId,
        cashierId: store.employee.id,
        cashierName: name,
        timestamp: new Date().toISOString(),
      });
    }

    // Start network comparison polling
    useComparisonStore.getState().startPolling();

    return () => {
      staffing.stop();
      useComparisonStore.getState().stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init peripheral bridge + cloud sync identity
  useEffect(() => {
    peripheralBridge.init(device.platform);
    cloudSync.initDevice(device.platform);
    const storeId = store.storeInfo?.siret || store.employee?.storeId || 'unknown';
    const storeName = store.storeInfo?.storeName || 'Unknown Store';
    cloudSync.registerDevice(storeId, storeName);
    if (store.employee) {
      cloudSync.startSession(
        store.employee.id,
        `${store.employee.firstName} ${store.employee.lastName}`,
        storeId,
        storeName,
      );
    }
    console.log(`[PLATFORM] ${device.platform} | ${device.inputMode} | ${device.screenClass} | ${device.viewportWidth}x${device.viewportHeight}`);
    return () => {
      peripheralBridge.destroy();
      cloudSync.endSession();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll occupancy + weather
  useEffect(() => {
    if (!store.employee) return;
    const storeId = store.employee.storeId;
    const fetchFlux = async () => {
      try {
        const [occRes, wxRes] = await Promise.all([
          occupancyApi.get(storeId),
          weatherApi.get(storeId),
        ]);
        store.setOccupancy(occRes.data);
        // Map enriched weather response → WeatherData
        const w = wxRes.data;
        if (w?.current) {
          store.setWeather({
            temp: w.current.temp,
            feelsLike: w.current.feelsLike,
            description: w.current.condition,
            icon: w.current.icon,
            city: w.storeCity || '',
            isRaining: w.current.isRaining,
            rainIntensity: w.current.rainIntensity,
            businessCategory: w.current.businessCategory,
            trafficImpact: w.trafficImpact,
            recommendations: w.recommendations?.map((r: any) => ({
              message: r.message,
              priority: r.priority,
            })),
          });
        }
      } catch { /* non-blocking */ }
    };
    fetchFlux();
    const interval = setInterval(fetchFlux, 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.employee?.storeId]);

  // Keyboard shortcuts (F2, F5, F8, F9, Escape)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // F2: Toggle scan mode (product/customer)
      if (e.key === 'F2') {
        e.preventDefault();
        store.setScanMode(store.scanMode === 'product' ? 'customer' : 'product');
      }
      // F5: Open payment modal
      if (e.key === 'F5') {
        e.preventDefault();
        if (store.cartItems.length > 0) store.setPaymentModalOpen(true);
      }
      // F8: Clear cart (if allowed)
      if (e.key === 'F8') {
        e.preventDefault();
        if (rights.canVoid) store.clearCart();
      }
      // F9: Open ticket history
      if (e.key === 'F9') {
        e.preventDefault();
        options?.onF9?.();
      }
      // Escape: close modals (delegated to caller)
      if (e.key === 'Escape') {
        e.preventDefault();
        if (options?.onEscape?.()) return;
        store.setPaymentModalOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.scanMode, store.cartItems.length, rights.canVoid, options?.onF9, options?.onEscape]);
}
