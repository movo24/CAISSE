import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePointageStore } from '../stores/pointageStore';

/**
 * Hook for pointage (clock in/out) in POS components.
 * Provides formatted shift duration, break status, and actions.
 * Duration auto-refreshes every 30 seconds.
 */
export function usePointage() {
  const store = usePointageStore();
  const [tick, setTick] = useState(0);

  // Refresh duration every 30s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load persisted data on mount
  useEffect(() => {
    store.loadPersistedData();
  }, []);

  const isClocked = store.currentShift !== null;
  const isOnBreak = store.isOnBreak();

  const shiftDuration = useMemo(
    () => store.getShiftDurationMinutes(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.currentShift, tick],
  );

  const breakMinutes = useMemo(
    () => store.getBreakMinutes(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.currentShift, tick],
  );

  const formattedDuration = useMemo(() => {
    if (!isClocked) return '--';
    const h = Math.floor(shiftDuration / 60);
    const m = shiftDuration % 60;
    if (h === 0) return `${m}min`;
    return `${h}h ${m.toString().padStart(2, '0')}min`;
  }, [isClocked, shiftDuration]);

  const formattedBreak = useMemo(() => {
    if (breakMinutes === 0) return null;
    const h = Math.floor(breakMinutes / 60);
    const m = breakMinutes % 60;
    if (h === 0) return `${m}min`;
    return `${h}h ${m.toString().padStart(2, '0')}min`;
  }, [breakMinutes]);

  const clockInTime = useMemo(() => {
    if (!store.currentShift) return null;
    const d = new Date(store.currentShift.clockInAt);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }, [store.currentShift]);

  const clockIn = useCallback(
    (employeeId: string, employeeName: string, storeId: string) => {
      if (!isClocked) store.clockIn(employeeId, employeeName, storeId);
    },
    [isClocked, store],
  );

  const clockOut = useCallback(
    (employeeId: string) => {
      if (isClocked) store.clockOut(employeeId);
    },
    [isClocked, store],
  );

  const startBreak = useCallback(
    (employeeId: string) => {
      if (isClocked && !isOnBreak) store.startBreak(employeeId);
    },
    [isClocked, isOnBreak, store],
  );

  const endBreak = useCallback(
    (employeeId: string) => {
      if (isClocked && isOnBreak) store.endBreak(employeeId);
    },
    [isClocked, isOnBreak, store],
  );

  return useMemo(
    () => ({
      isClocked,
      isOnBreak,
      shiftDuration,
      formattedDuration,
      breakMinutes,
      formattedBreak,
      clockInTime,
      clockIn,
      clockOut,
      startBreak,
      endBreak,
    }),
    [isClocked, isOnBreak, shiftDuration, formattedDuration, breakMinutes,
     formattedBreak, clockInTime, clockIn, clockOut, startBreak, endBreak],
  );
}
