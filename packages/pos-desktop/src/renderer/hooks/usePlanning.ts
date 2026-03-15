import { useState, useEffect } from 'react';
import { usePlanningStore, PlannedShift } from '../stores/planningStore';

/* ═══════════════════════════════════════════════════════════════
   usePlanning — Hook planning pour le POS
   Refresh toutes les 60s pour mettre à jour les indicateurs
   ═══════════════════════════════════════════════════════════════ */

export function usePlanning() {
  const store = usePlanningStore;
  const weekPlanning = usePlanningStore((s) => s.weekPlanning);
  const [, setTick] = useState(0);

  // Re-render every 60s to update remaining time & progress
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const todayShift = store.getState().getTodayShift();
  const isOutside = store.getState().isOutsidePlannedShift();
  const isBefore = store.getState().isBeforeShift();
  const isAfter = store.getState().isAfterShift();
  const remainingMinutes = store.getState().getRemainingMinutes();
  const shiftProgress = store.getState().getShiftProgress();
  const weekHoursPlanned = store.getState().getWeekHoursPlanned();

  // Formatted remaining
  const formattedRemaining = remainingMinutes > 0
    ? remainingMinutes >= 60
      ? `${Math.floor(remainingMinutes / 60)}h${String(remainingMinutes % 60).padStart(2, '0')}`
      : `${remainingMinutes}min`
    : '--';

  // Formatted shift time
  const formattedShiftTime = todayShift
    ? `${todayShift.startTime} - ${todayShift.endTime}`
    : 'Repos';

  // Warning message
  let warningMessage = '';
  if (todayShift && isOutside) {
    if (isBefore) {
      warningMessage = `Votre creneau commence a ${todayShift.startTime}`;
    } else if (isAfter) {
      warningMessage = `Votre creneau s'est termine a ${todayShift.endTime}`;
    }
  } else if (!todayShift && weekPlanning) {
    warningMessage = 'Pas de creneau planifie aujourd\'hui';
  }

  return {
    // Data
    todayShift,
    weekPlanning,
    hasPlanning: weekPlanning !== null,

    // Booleans
    isOutsidePlannedShift: isOutside,
    isBeforeShift: isBefore,
    isAfterShift: isAfter,
    hasShiftToday: todayShift !== null,

    // Computed
    remainingMinutes,
    shiftProgress,
    weekHoursPlanned,

    // Formatted
    formattedRemaining,
    formattedShiftTime,
    warningMessage,
  };
}
